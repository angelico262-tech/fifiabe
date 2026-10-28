// backend/src/adapters/paymentInstructions/PaymentInstructionsAdapter.ts
//
// Interface d'adaptateur pour la génération des instructions de paiement
// remises au passager (aujourd'hui : numéros Mvola/Orange Money/Airtel
// Money saisis manuellement par l'opérateur, affichés tels quels).
//
// Aucune intégration USSD réelle n'est implémentée ici — ce fichier ne fait
// que définir le contrat, pour que l'ajout futur d'un canal USSD (ou d'une
// API mobile money réelle) se fasse en ajoutant une nouvelle classe qui
// implémente cette interface, sans toucher au code appelant (routes,
// services) qui ne dépend que de `PaymentInstructionsAdapter`.

export type PaymentInstructions = {
  network: 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY' | null;
  number: string | null;
  accountName: string | null;
  message: string | null;
};

export type TripPaymentFields = {
  mvolaNumber: string | null;
  mvolaAccountName: string | null;
  orangeMoneyNumber: string | null;
  orangeMoneyAccountName: string | null;
  airtelMoneyNumber: string | null;
  airtelMoneyAccountName: string | null;
  paymentMessage: string | null;
};

export interface PaymentInstructionsAdapter {
  /** Construit les instructions à afficher au passager pour ce voyage. */
  buildInstructions(trip: TripPaymentFields): PaymentInstructions[];
}
