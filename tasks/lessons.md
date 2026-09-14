# Leçons

Format : [date] | ce qui a mal tourné | règle pour l'éviter

- [2026-09-14] | Un `<span>` en `absolute` sans `left-0` dans le toggle : le
  curseur partait de sa position statique (centrée par le `text-align` du
  bouton) et restait à droite dans les deux états. | Un élément positionné en
  absolu doit toujours recevoir son ancrage explicite (`left`/`top`), jamais
  compter sur sa position statique.
- [2026-09-14] | `scripts/hash-password.mjs` importait `bcryptjs` alors que Next
  l'inline dans ses bundles serveur : le module est absent de `node_modules`
  dans l'image `standalone`, le script aurait échoué au premier usage. | Vérifier
  le contenu réel de `.next/standalone/node_modules` avant de promettre qu'un
  script utilitaire tourne dans l'image de production.
- [2026-09-14] | Accord fautif « 1 changements de prix » sur l'écran Réglages. |
  Passer tout compteur affiché par une fonction d'accord plutôt que de
  concaténer un `s`.
- [2026-09-14] | Le validateur de palette a signalé vert↔orange à ΔE 6.3 en
  vision deutan. | Une information portée par la couleur (hausse/baisse) doit
  toujours être doublée d'un signe : flèche + montant signé.

## Règles permanentes du projet
- Un seul client MongoDB, `maxPoolSize` bas : le quota de 500 connexions est
  partagé entre plusieurs applications.
- Jamais de secret en clair : mot de passe hashé (bcrypt), session leboncoin
  chiffrée AES-256-GCM.
- Aucune identité personnelle dans le code, les commits ou les messages.
- Le front ne requête jamais Mongo directement : tout passe par l'API.
- Un prix ne s'interpole pas : le graphe est en marches d'escalier, une ligne
  droite entre deux relevés inventerait des valeurs qui n'ont pas existé.
