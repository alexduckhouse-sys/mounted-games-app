import type { Message } from '../messages';

export const timing = {
  "timing.start": "Dechrau ras · baner i lawr",
  "timing.skip": "Sgorio heb amser dechrau",
  "timing.storage": "Ni ellid cadw’r amser dechrau ar y ffôn hwn. Rhyddhewch le neu sgoriwch heb amser dechrau.",
  "timing.jump": "Neidio i ras",
  "timing.choose": "Dewiswch ras",
  "timing.estimated": " (amcangyfrif)",
  "timing.review": "Adolygu cyflymder y rasys",
  "timing.explain": "Mae’r amcangyfrifon yn cynnwys newid offer ac amser cofnodi sgoriau. Nid yw’r amseroedd cyhoeddedig yn newid.",
  "timing.loadError": "Ni ellid llwytho’r amcangyfrifon. Agorwch y dudalen eto pan fydd signal.",
  "timing.empty": "Dim cyfnodau wedi’u cofnodi i’w cymharu eto.",
  "timing.waiting": "Aros am bum cyfnod tebyg",
  "timing.estimate": "Tua {minutes} munud fesul cyfnod · {samples} sampl",
  "timing.holds": "Seibiannau hir wedi’u hepgor: {count}",
  "timing.error": "Gwall arferol mewn gwiriadau blaenorol: {minutes} munud.",
  "timing.share": "Rhannu clip"
} satisfies Record<string, Message>;
