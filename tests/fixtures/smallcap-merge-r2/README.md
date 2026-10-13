# R2 merge regression fixture

`colliding-manifest.txt` is the unchanged metadata input used by R2's
`_scratch/r2/reproduce.cjs`, from public Small-Cap run 36564774335 (2026-09-29),
merge job 109395897632. It contains public pipeline diagnostics, no private
user data or credentials. Company observations in the test are synthetic.

The first 24,397 bytes are shard 1's complete `_manifest-full.json`, followed
by shard 0's tail through byte 28,482 and a final newline. Each original shard
report parses alone; the colliding input fails JSON parsing at position 24,397.
Keep this malformed input as text: a JSON formatter would destroy the regression.

Size: 28,483 bytes. SHA256:
`484632bd037e8b3de43e9c068488f72dd283569b2504e8edb5fb3ad6688c904d`.

Source: https://github.com/Karlryl/screener-data/actions/runs/36564774335/job/109395897632
