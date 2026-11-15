# WO-009 — owner listening samples (pending)

These are synthetic acceptance samples for ENH-14. They use the local
`pt_BR-cadu-medium` Piper voice (CC0) plus generated ambience/step/radio tones.
They are **not** human acceptance evidence until the owner listens.

- `steps-left-right.mp4`: ambience bed + a step moving left → right; voice on top.
- `radio-far-near.mp4`: radio moving far → near; voice on top.

Listen with headphones. The processed stereo is a simulation (pan, delay,
filters, echo), not Dolby Atmos or tracked 3D audio. Mono downmix and true
peak/LUFS are covered by automated tests.

SHA-256:
- `radio-far-near.mp4` `d28219b6d2c943b1d087ed401a5e7f6162ba8e60913248b320e490e6528241e9`
- `steps-left-right.mp4` `3e26777786f0c92ec577f36d666007f8fed20435015b1bd12662fbf682a0eac8`
