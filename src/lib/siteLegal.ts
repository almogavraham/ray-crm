/**
 * siteLegal.ts — who operates the site, and the versioned consent wording.
 *
 * The identity fields are optional and rendered only when filled. RAY has no
 * registered legal entity yet, and a privacy policy naming a company that does
 * not exist, or an invented address, is worse than one that simply identifies
 * the operator by the contact channel that really works. Fill these in when the
 * entity is registered — every page that needs them picks them up from here.
 */

export const SITE_LEGAL = {
  /** Trading name shown throughout the site. */
  brand: 'RAY CRM',
  site: 'ray-crm.com',

  /** Registered company name. Empty until an entity exists. */
  legalName: '',
  /** ח.פ / ע.מ. Empty until an entity exists. */
  companyId: '',
  /** Registered address. Empty until an entity exists. */
  address: '',

  /** Real, monitored addresses — safe to publish. */
  contactEmail: 'hello@ray-crm.com',
  privacyEmail: 'hello@ray-crm.com',
  accessibilityEmail: 'hello@ray-crm.com',

  /** Person responsible for accessibility. Empty until appointed. */
  accessibilityOfficer: '',

  /** Last substantive review of the legal texts. */
  updated: '30.8.2026',
} as const;

/** True once the site can name a legal entity for itself. */
export const hasLegalEntity = () => Boolean(SITE_LEGAL.legalName && SITE_LEGAL.companyId);

/**
 * The exact wording a contact-form submitter agrees to. Stored with the lead,
 * so a later dispute is settled by what was actually shown rather than by
 * whatever the form happens to say by then. Bump the version when it changes.
 */
export const CONTACT_CONSENT_VERSION = '1.0';
export const CONTACT_CONSENT_TEXT =
  'קראתי ואני מסכים/ה למדיניות הפרטיות ולתנאי השימוש, ומאשר/ת שתיצרו איתי קשר בנוגע לפנייה זו.';

export const MARKETING_CONSENT_TEXT =
  'אני מאשר/ת קבלת דיוור שיווקי, עדכונים והצעות מ-RAY CRM בדוא״ל, בהודעות SMS ובוואטסאפ. ניתן להסיר בכל עת.';
