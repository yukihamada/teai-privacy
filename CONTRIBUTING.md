# Contributing

Use Node 22+. Run `npm ci && npm run check && npm audit` before a PR.

For detector changes, add **synthetic** positive and negative fixtures and an upstream-boundary test. Report missed formats and false positives separately. Do not expand supported surfaces without reviewing every field that can carry text or credentials. Keep request inspection fail-closed and response streaming cancellation intact.

Never paste real prompts, keys or customer data into issues, logs or tests. Update README.md, README.ja.md and SECURITY.md together. Security reports: see SECURITY.md.

日本語：検出ルールを変える際は、合成データで検出・誤検出・送信境界を検証し、日英の説明と限界を更新してください。実データや本物の鍵は使わないでください。
