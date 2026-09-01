/**
 * vat.ts — the Israeli VAT rate, in one place.
 *
 * It was previously written out as `0.17` in four files and as the literal
 * string "17%" in four more. Israeli VAT rose to 18% in January 2025, and
 * because the rate lived in eight places it was updated in none of them: the
 * billing page had been corrected to 18% while its own label still read 17%,
 * and quotes and invoices generated for customers were still computing the old
 * rate — under-charging VAT on documents that go out to real clients.
 *
 * So the number lives here and nowhere else. A future change is one edit, and
 * labels derive from the same constant rather than restating it, which is what
 * let the display and the arithmetic disagree in the first place.
 *
 * This governs what the UI shows and what quotes compute. It does not govern
 * the tax on a subscription charge — Morning computes that from the business's
 * own tax settings when it issues the invoice, so that path stays correct on
 * its own.
 */

/** Israeli VAT, as a fraction. 18% since January 2025. */
export const VAT_RATE = 0.18;

/** The rate as a whole number, for labels: `מע״מ (18%)`. */
export const VAT_PERCENT = Math.round(VAT_RATE * 100);

/** VAT on a pre-VAT amount, rounded to the agora. */
export const vatOn = (amount: number): number =>
  Math.round(amount * VAT_RATE * 100) / 100;

/** A pre-VAT amount plus its VAT, rounded to the agora. */
export const withVat = (amount: number): number =>
  Math.round(amount * (1 + VAT_RATE) * 100) / 100;
