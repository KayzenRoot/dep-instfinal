# WO-010 — revisão humana dos presets

Data: 2026-11-17

Estes três clipes são **excertos sintéticos de QA** (12 s, 540×960, H.264/AAC),
não episódios completos. Servem para o owner comparar o comportamento visual e
auditivo dos presets antes do merge. A trilha é sintética (90 Hz), a voz é a
amostra aprovada da WO-007 e os SFX são tons de teste; nenhuma mídia privada de
produção foi usada.

| Arquivo             | VHS    | SFX | Silêncio pré-revelação | SHA-256                                                            |
| ------------------- | ------ | --- | ---------------------- | ------------------------------------------------------------------ |
| `slow-burn.mp4`     | 300 ms | 0   | 6,0–7,2 s              | `b033607999682c6d8ebc470a127f97e687f5d73d61ac1fe130b13cdcb0effa6f` |
| `reveal.mp4`        | 500 ms | 1   | 6,0–7,2 s              | `96cf2df996c998cb0daa5ca4d10a8630b9efb5ce35f02e0943ddab4ab282462c` |
| `found-footage.mp4` | 700 ms | 2   | 6,0–7,2 s              | `a0ca729c23046a518550b64c8c7c406d7ef65ab8381baa401b68f4bb387a662c` |

Todos têm 12,000 s, H.264 540×960, AAC 48 kHz estéreo. O VHS ocorre em 7,8 s e
é o único parâmetro visual alterado entre presets; a diferença de SFX e a pausa
de ambiência são audíveis no mesmo trecho.

## O que o owner deve avaliar

1. `slow-burn` parece mais contido que `reveal` (glitch mais curto, sem SFX).
2. `reveal` tem um acento e glitch intermediário, sem estouro de volume.
3. `found-footage` tem dois acentos e glitch mais longo, ainda ≤700 ms.
4. O silêncio de ambiência não corta a voz e não gera clique.
5. Nenhum preset causa flash/volume excessivo ou desconforto fotossensível.

## Limitações

- São excertos, não o render de 120 s/15 cenas; o E2E e o CI cobrem o fluxo real.
- A aprovação humana é uma etapa separada; o arquivo de aceitação só será
  preenchido com a resposta explícita do owner.
- O preset não muda o ritmo de cortes nem o contraste das legendas nesta versão.
