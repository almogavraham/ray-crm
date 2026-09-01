/**
 * siteLegal.ts — who operates the site, and the versioned consent wording.
 *
 * The identity fields are optional and rendered only when filled, because a
 * privacy policy naming a company that does not exist is worse than one that
 * identifies the operator by a contact channel that really works. They are
 * filled in now: the business is a registered עוסק מורשה.
 *
 * These are not decoration. A payment provider will not approve a site for
 * card processing unless the operator's name, business number, physical
 * address and phone are actually published on it, alongside a cancellation
 * policy — so every field here is load-bearing for taking payment at all.
 */

export const SITE_LEGAL = {
  /** Trading name shown throughout the site. */
  brand: 'RAY CRM',
  site: 'ray-crm.com',

  /** Registered business name. */
  legalName: 'רעות זומר',
  /** ע.מ (עוסק מורשה). */
  companyId: '301737110',
  /** Registered business address. */
  address: 'אלעזר רוקח 21, תל אביב',
  /** Published business phone. Israeli local format; tel: link is built from it. */
  phone: '03-7221650',

  /** Real, monitored addresses — safe to publish. */
  contactEmail: 'hello@ray-crm.com',
  privacyEmail: 'hello@ray-crm.com',
  accessibilityEmail: 'hello@ray-crm.com',

  /** Person responsible for accessibility. Empty until appointed. */
  accessibilityOfficer: '',

  /** Last substantive review of the legal texts. */
  updated: '1.9.2026',
} as const;

/** True once the site can name a legal entity for itself. */
export const hasLegalEntity = () => Boolean(SITE_LEGAL.legalName && SITE_LEGAL.companyId);

/**
 * The published phone as a dialable href, in international form so it works
 * from a phone abroad and from desktop dialers that reject local prefixes.
 */
export const telHref = () => {
  const digits = SITE_LEGAL.phone.replace(/\D/g, '');
  return `tel:+972${digits.replace(/^0/, '')}`;
};

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
