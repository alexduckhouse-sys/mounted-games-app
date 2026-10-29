import type { Message } from '../messages';

export const timing = {
  "timing.start": "Départ de la course · drapeau baissé",
  "timing.skip": "Saisir les scores sans heure de départ",
  "timing.storage": "L’heure de départ n’a pas pu être enregistrée sur ce téléphone. Libérez de l’espace ou saisissez les scores sans heure de départ.",
  "timing.jump": "Aller à une course",
  "timing.choose": "Choisir une course",
  "timing.estimated": " (estimé)",
  "timing.review": "Examiner le rythme des courses",
  "timing.explain": "Les estimations comprennent les changements de matériel et la saisie des scores. Les horaires publiés restent inchangés.",
  "timing.loadError": "Impossible de charger les estimations. Rouvrez cette page lorsque le réseau est disponible.",
  "timing.empty": "Aucun créneau enregistré à comparer pour le moment.",
  "timing.waiting": "En attente de cinq créneaux comparables",
  "timing.estimate": "Environ {minutes} min par créneau · {samples} observations",
  "timing.holds": "Longues interruptions exclues : {count}",
  "timing.error": "Erreur habituelle lors des vérifications passées : {minutes} min.",
  "timing.share": "Partager la vidéo"
} satisfies Record<string, Message>;
