# allin1 natten patch

Two files vendored from an unmerged upstream fix:
https://github.com/mir-aidj/all-in-one/pull/39 (by GitHub user `jdf`,
branch `torch-natten-fallback`), which replaces allin1's dependency on
the compiled `natten` package with a plain-PyTorch equivalent (einsum +
indexing), used for CPU/MPS and whenever `natten` isn't importable at
all; `natten`'s compiled kernel is only used for actual CUDA tensors.
Verified by that PR against 54 test cases to produce identical output
to `natten`.

**Why this exists**: allin1's shipped `dinat.py` unconditionally
imports low-level functions (`natten1dav`, `natten1dqkrpb`, ...) from
`natten.functional` that were removed from every `natten` release still
capable of installing against a current PyTorch (see the main
README's git history for the full investigation) — so `import allin1`
fails outright on a normal, current install. This patch makes `natten`
optional instead, which is also just a better default for a CPU-only
container: the PR's own benchmark showed the plain-PyTorch path is
*faster* than natten's CPU kernel anyway (11s vs 148s on their test
machine).

**Why vendored instead of installed from the PR's branch directly**:
that branch belongs to a personal fork and could be force-pushed,
renamed, or deleted at any time, which would silently break future
Docker builds. Copying the two files in in-repo, applied by the
Dockerfile, means the build never depends on that branch continuing to
exist.

Both files are adapted from allin1 (MIT-licensed), which itself adapts
code from Hugging Face `transformers`' DiNAT model (Apache-2.0) — see
each file's own header comment.

If/when PR #39 (or an equivalent fix) is merged upstream and a new
`allin1` release picks it up, this patch step becomes unnecessary and
can be dropped from the Dockerfile.
