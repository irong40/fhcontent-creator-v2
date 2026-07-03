#!/usr/bin/env python3
"""ollama-grade.py — local pre-filter that grades a social post with the
post-grader skill rubric using Ollama (mistral:7b, format:json).

The 7 dimension scores and the judgment-call voice rules come from the model.
The mechanical voice rules (em dashes, filler words/openers, hashtag count)
and the weighted overall score are computed deterministically in Python, so
a 7B model's arithmetic never touches the final number.

Usage:
  python ollama-grade.py post.txt --platform linkedin
  echo "post text" | python ollama-grade.py - --platform instagram --markdown
  python ollama-grade.py post.txt --platform twitter --brief brand-brief.md

Exit codes: 0 = graded, 1 = usage/input error, 2 = Ollama unreachable/bad reply.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

SKILL_PATH = Path.home() / ".claude" / "skills" / "post-grader" / "SKILL.md"

WEIGHTS = {
    "hook": 0.50,
    "curiosity": 0.10,
    "emotion": 0.10,
    "share": 0.10,
    "voice": 0.10,
    "polarity": 0.05,
    "platform_fit": 0.05,
}

DIMENSION_LABELS = {
    "hook": "Hook strength",
    "curiosity": "Curiosity & specificity",
    "emotion": "Emotional charge",
    "share": "Share-worthiness",
    "voice": "Voice match",
    "polarity": "Polarity",
    "platform_fit": "Platform fit",
}

FILLER_WORDS = ["really", "very", "just", "basically", "literally", "actually", "simply"]
FILLER_OPENERS = ["in today's world", "let me tell you", "the truth is", "here's the thing"]

# 0 hashtags for text-first platforms, ranges for the visual ones.
# Covers the full Blotato publish target list (src/lib/blotato.ts Platform).
HASHTAG_LIMITS = {
    "twitter": (0, 0), "x": (0, 0), "threads": (0, 0), "bluesky": (0, 0),
    "linkedin": (0, 0), "facebook": (0, 0),
    "instagram": (3, 5), "tiktok": (0, 5),
    "youtube": (0, 3), "pinterest": (0, 5),
}


def read_post(source):
    if source == "-":
        text = sys.stdin.read()
    else:
        p = Path(source)
        if not p.is_file():
            sys.exit(f"error: post file not found: {source}")
        text = p.read_text(encoding="utf-8")
    text = text.strip()
    if not text:
        sys.exit("error: post text is empty")
    return text


def extract_rubric(skill_md):
    """Pull the dimension definitions (Step 3 table) out of SKILL.md so the
    model grades against the live skill text, not a stale embedded copy."""
    m = re.search(r"### Step 3.*?(?=### Step 4)", skill_md, re.DOTALL)
    return m.group(0).strip() if m else skill_md


def mechanical_rules(post, platform):
    """Pass/fail checks that need no model."""
    results = {}

    results["em_dashes"] = {
        "pass": "—" not in post,
        "violation": "" if "—" not in post else f"{post.count(chr(0x2014))} em dash(es) found",
    }

    lower = post.lower()
    hits = sorted({w for w in FILLER_WORDS if re.search(rf"\b{w}\b", lower)})
    results["filler_words"] = {
        "pass": not hits,
        "violation": ", ".join(hits),
    }

    opener_hits = [o for o in FILLER_OPENERS if o in lower]
    results["filler_openers"] = {
        "pass": not opener_hits,
        "violation": ", ".join(opener_hits),
    }

    tags = re.findall(r"#\w+", post)
    lo, hi = HASHTAG_LIMITS.get(platform, (0, 5))
    ok = lo <= len(tags) <= hi
    results["hashtag_count"] = {
        "pass": ok,
        "violation": "" if ok else f"{len(tags)} hashtags (allowed {lo}-{hi} on {platform})",
    }

    spelled = re.findall(
        r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+"
        r"(tips?|ways?|steps?|reasons?|things?|lessons?|mistakes?|rules?|secrets?|hacks?|ideas?|strategies)\b",
        lower,
    )
    results["numbers_as_digits"] = {
        "pass": not spelled,
        "violation": ", ".join(f"{n} {w}" for n, w in spelled),
    }

    passive = re.findall(
        r"\b(?:was|were|is being|are being|has been|have been)\s+"
        r"(?:\w+(?:ed|en)|\w*(?:built|done|made|held|kept|left|lost|paid|sent|set|shown|sold|told|won))\b",
        lower,
    )
    results["active_voice"] = {
        "pass": not passive,
        "violation": ", ".join(sorted(set(passive))),
    }

    return results


MODEL_SCHEMA = """{
  "dimensions": {
    "hook":         {"score": <int 0-10>, "note": "<1 line, required if under 8>"},
    "curiosity":    {"score": <int 0-10>, "note": "..."},
    "emotion":      {"score": <int 0-10>, "note": "..."},
    "share":        {"score": <int 0-10>, "note": "..."},
    "voice":        {"score": <int 0-10 or null if no brand brief>, "note": "..."},
    "polarity":     {"score": <int 0-10>, "note": "..."},
    "platform_fit": {"score": <int 0-10>, "note": "..."}
  },
  "rules": {
    "contractions":      {"pass": <bool>, "violation": "<quote or empty>"},
    "numbers_as_digits": {"pass": <bool>, "violation": "<quote or empty>"},
    "active_voice":      {"pass": <bool>, "violation": "<quote or empty>"}
  },
  "fixes": [
    {"issue": "<title>", "current": "<exact quote from post>", "why": "<cost>", "fix": "<specific rewrite>"},
    {"issue": "...", "current": "...", "why": "...", "fix": "..."},
    {"issue": "...", "current": "...", "why": "...", "fix": "..."}
  ]
}"""


def build_prompt(post, platform, rubric, brief):
    parts = [
        "You are a harsh but fair social media post grader. Grade the post below "
        "for VIRALITY. A 7 is good, an 8 is strong, a 9 means almost nothing needs "
        "fixing, a 10 does not exist. Most hooks are 4-6/10. Do not pad scores.",
        "",
        "GRADING RUBRIC (score each dimension 0-10):",
        rubric,
        "",
        "Also judge these 3 pass/fail voice rules:",
        '- contractions: "don\'t" must be used over "do not", "you\'ve" over "you have"',
        '- numbers_as_digits: "5 tips" not "five tips"',
        '- active_voice: no "was created by", "is being done", "has been built"',
        "",
        f"TARGET PLATFORM: {platform}",
    ]
    if brief:
        parts += ["", "BRAND BRIEF (grade voice match against this):", brief]
    else:
        parts += ["", "No brand brief provided: set dimensions.voice.score to null."]
    parts += [
        "",
        "POST TO GRADE:",
        "---",
        post,
        "---",
        "",
        "Respond with ONLY a JSON object in exactly this shape:",
        MODEL_SCHEMA,
        "",
        "The 3 fixes must be the changes that raise the score most, ranked by "
        "impact. Quote the actual post text in 'current'. Give an exact rewrite "
        "in 'fix', not vague advice.",
    ]
    return "\n".join(parts)


def call_ollama(prompt, model, host, timeout):
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{host}/api/generate", data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            reply = json.load(resp)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"error: Ollama unreachable at {host}: {e}", file=sys.stderr)
        sys.exit(2)
    try:
        return json.loads(reply["response"])
    except (KeyError, json.JSONDecodeError) as e:
        print(f"error: model returned unparseable JSON: {e}", file=sys.stderr)
        print(reply.get("response", "")[:2000], file=sys.stderr)
        sys.exit(2)


def clamp_score(value):
    try:
        return max(0, min(10, int(value)))
    except (TypeError, ValueError):
        return None


def compute_overall(dimensions, rules):
    """Weighted average per the skill: hook 50%, then 10/10/10/10/5/5.
    If voice was skipped (no brief), renormalize the remaining weights.
    Each failed voice rule subtracts 0.5, capped at -3 total."""
    weights = dict(WEIGHTS)
    if dimensions["voice"]["score"] is None:
        del weights["voice"]
        total = sum(weights.values())
        weights = {k: v / total for k, v in weights.items()}

    score = sum(weights[k] * dimensions[k]["score"] for k in weights)
    penalty = min(3.0, 0.5 * sum(1 for r in rules.values() if not r["pass"]))
    return round(max(0.0, score - penalty), 1), penalty, weights


def render_markdown(result):
    d, r = result["dimensions"], result["rules"]
    lines = [
        f"## Post Grade: {result['overall']}/10",
        "",
        "### Score Breakdown",
        "",
        "| Dimension | Weight | Score | Note |",
        "|-----------|--------|-------|------|",
    ]
    weights_used = result["weights_used"]
    for key, label in DIMENSION_LABELS.items():
        w = f"{round(weights_used[key] * 100)}%" if key in weights_used else "n/a"
        s = d[key]["score"]
        s = "skipped (no brief)" if s is None else f"{s}/10"
        lines.append(f"| {label} | {w} | {s} | {d[key]['note']} |")
    lines += ["", "### Voice Rules Audit", "", "| Rule | Pass/Fail | Violation |", "|------|-----------|-----------|"]
    for key, rule in r.items():
        lines.append(f"| {key.replace('_', ' ')} | {'Pass' if rule['pass'] else 'FAIL'} | {rule['violation']} |")
    lines += ["", "### Top 3 Fixes (ranked by impact)", ""]
    for i, f in enumerate(result["fixes"][:3], 1):
        lines += [
            f"**{i}. {f['issue']}**",
            f"- Current: \"{f['current']}\"",
            f"- Why it hurts: {f['why']}",
            f"- Fix: {f['fix']}",
            "",
        ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Grade a social post locally via Ollama using the post-grader skill rubric.")
    ap.add_argument("post", help="path to post text file, or - for stdin")
    ap.add_argument("--platform", required=True,
                    choices=sorted(HASHTAG_LIMITS), help="target platform")
    ap.add_argument("--brief", help="path to brand-brief.md for voice-match grading")
    ap.add_argument("--model", default="mistral:7b")
    ap.add_argument("--host", default="http://localhost:11434")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--markdown", action="store_true", help="print the skill-format scorecard instead of JSON")
    args = ap.parse_args()

    post = read_post(args.post)

    brief = None
    if args.brief:
        p = Path(args.brief)
        if not p.is_file():
            sys.exit(f"error: brand brief not found: {args.brief}")
        brief = p.read_text(encoding="utf-8")

    if not SKILL_PATH.is_file():
        sys.exit(f"error: post-grader skill not found at {SKILL_PATH}")
    rubric = extract_rubric(SKILL_PATH.read_text(encoding="utf-8"))

    model_out = call_ollama(build_prompt(post, args.platform, rubric, brief),
                            args.model, args.host, args.timeout)

    dimensions = {}
    for key in WEIGHTS:
        raw = model_out.get("dimensions", {}).get(key, {})
        score = clamp_score(raw.get("score"))
        if key == "voice" and (brief is None or raw.get("score") is None):
            score = None
        elif score is None:
            score = 5  # model omitted a dimension: neutral, flagged in note
        note = str(raw.get("note", "") or "")
        if score is None:
            note = note or "no brand brief provided"
        dimensions[key] = {"score": score, "note": note}

    rules = mechanical_rules(post, args.platform)
    for key in ("contractions", "numbers_as_digits", "active_voice"):
        raw = model_out.get("rules", {}).get(key, {})
        model_pass = bool(raw.get("pass", True))
        model_violation = str(raw.get("violation", "") or "")
        if key in rules:
            # regex check exists: fail if EITHER the regex or the model flags it
            if rules[key]["pass"] and not model_pass:
                rules[key] = {"pass": False, "violation": model_violation}
        else:
            rules[key] = {"pass": model_pass, "violation": model_violation}

    fixes = [
        {
            "issue": str(f.get("issue", "")),
            "current": str(f.get("current", "")),
            "why": str(f.get("why", "")),
            "fix": str(f.get("fix", "")),
        }
        for f in model_out.get("fixes", [])[:3]
    ]

    overall, penalty, weights_used = compute_overall(dimensions, rules)
    result = {
        "overall": overall,
        "rule_penalty": penalty,
        "weights_used": {k: round(v, 4) for k, v in weights_used.items()},
        "dimensions": dimensions,
        "rules": rules,
        "fixes": fixes,
        "platform": args.platform,
        "model": args.model,
        "publish_ready": overall >= 8.0,
    }

    if args.markdown:
        print(render_markdown(result))
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
