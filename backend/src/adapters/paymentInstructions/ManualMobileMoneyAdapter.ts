// backend/src/adapters/paymentInstructions/ManualMobileMoneyAdapter.ts
//
// Implémentation actuelle (comportement inchangé) : les numéros Mvola,
// Orange Money et Airtel Money sont saisis manuellement par l'opérateur sur
// le voyage et simplement restitués au passager. Aucun appel réseau, aucune
// vérification automatique du paiement.

import { PaymentInstructions, PaymentInstructionsAdapter, TripPaymentFields } from './PaymentInstructionsAdapter.js';

export class ManualMobileMoneyAdapter implements PaymentInstructionsAdapter {
  buildInstructions(trip: TripPaymentFields): PaymentInstructions[] {
    const instructions: PaymentInstructions[] = [];

    if (trip.mvolaNumber) {
      instructions.push({
        network: 'MVOLA',
        number: trip.mvolaNumber,
        accountName: trip.mvolaAccountName,
        message: trip.paymentMessage,
      });
    }
    if (trip.orangeMoneyNumber) {
      instructions.push({
        network: 'ORANGE_MONEY',
        number: trip.orangeMoneyNumber,
        accountName: trip.orangeMoneyAccountName,
        message: trip.paymentMessage,
      });
    }
    if (trip.airtelMoneyNumber) {
      instructions.push({
        network: 'AIRTEL_MONEY',
        number: trip.airtelMoneyNumber,
        accountName: trip.airtelMoneyAccountName,
        message: trip.paymentMessage,
      });
    }

    return instructions;
  }
}
