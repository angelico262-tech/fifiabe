// backend/src/config/organization.ts
//
// Point d'entrée UNIQUE pour tout ce qui identifie l'organisation exploitante
// (FIFIABE aujourd'hui). Objectif : que plus aucun endroit du code ne
// contienne le texte "FIFIABE" ou le préfixe "FIF-" en dur.
//
// Ce fichier NE MET PAS EN PLACE le multi-coopérative (aucun modèle
// `Cooperative` en base, aucune migration). Il prépare seulement le point
// d'extension : le jour où une table `Cooperative` existera, seule la
// fonction `getCurrentCooperativeId()` ci-dessous devra changer (lire le
// tenant depuis la requête/le sous-domaine/etc.) — aucun appelant n'aura à
// être modifié, puisqu'ils passent déjà par cette fonction plutôt que par
// une constante éparpillée.

export const organizationConfig = {
  /** Nom affiché dans les messages utilisateur (erreurs, emails, reçus...). */
  brandName: process.env.ORG_BRAND_NAME?.trim() || 'FIFIABE',

  /**
   * Préfixe des références de réservation publique (ex. "FIF-3D70DA41B0").
   * Doit être stable en production : le changer casse la validation des
   * anciennes références. À ne modifier qu'en connaissance de cause.
   */
  bookingReferencePrefix: process.env.ORG_BOOKING_REFERENCE_PREFIX?.trim() || 'FIF',
} as const;

/**
 * Identifiant de la coopérative courante.
 *
 * Aujourd'hui : une seule coopérative existe (FIFIABE), donc cette fonction
 * renvoie toujours la même valeur constante et aucune requête Prisma ne
 * filtre encore par coopérative.
 *
 * Demain (si le multi-coopérative est activé) : cette fonction sera le
 * SEUL endroit à modifier pour dériver le tenant réel (sous-domaine, en-tête
 * de requête, JWT...). Les services qui l'appellent déjà (voir
 * tripSchedulingService.ts) n'auront pas besoin d'être réécrits, seulement
 * reliés à un vrai modèle `Cooperative` une fois celui-ci créé par migration.
 */
export function getCurrentCooperativeId(): string {
  return process.env.ORG_COOPERATIVE_ID?.trim() || 'fifiabe-default';
}
