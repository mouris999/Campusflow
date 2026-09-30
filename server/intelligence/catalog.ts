/**
 * Verified service catalogue.
 *
 * These are the real item / resource / task records that the alternative engine
 * is allowed to reason about. Availability is a stored fact with a source
 * system and a timestamp — the engine never infers it, and never invents an
 * item that is not in this catalogue.
 */

import type { ServiceItem, ServiceItemKind } from '../../src/types/traffic.js';

export interface CatalogSeedEntry {
  key: string;
  kind: ServiceItemKind;
  description: string;
  synonyms: string[];
  available: boolean;
  quantity: number;
  capacity?: number;
  unit: string;
  reservation?: boolean;
  source: string;
  note?: string;
}

export const CATALOG_SOURCE = {
  canteen: 'canteen-pos',
  library: 'library-inventory',
  admin: 'registrar-records',
  bursar: 'bursar-ledger',
  lab: 'lab-store-ledger',
  maker: 'maker-lab-booking',
  it: 'it-service-desk'
} as const;

/** Keyed by service id. */
export const SERVICE_CATALOG: Record<string, CatalogSeedEntry[]> = {
  'srv-canteen-main': [
    {
      key: 'veg-thali',
      kind: 'menu_item',
      description: 'Two rotating vegetarian curries, rice, roti, salad and dessert.',
      synonyms: ['veg thali', 'vegetarian thali', 'vegetable thali', 'thali', 'veg platter'],
      available: true,
      quantity: 42,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'veg-biryani',
      kind: 'menu_item',
      description: 'Basmati rice cooked with seasonal vegetables and spices.',
      synonyms: ['veg biryani', 'vegetable biryani', 'biryani'],
      available: true,
      quantity: 18,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'chole-bhature',
      kind: 'menu_item',
      description: 'Chickpea curry served with fried bread.',
      synonyms: ['chole bhature', 'chole', 'bhature'],
      available: true,
      quantity: 25,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'masala-dosa',
      kind: 'menu_item',
      description: 'Crisp dosa with potato masala and chutney.',
      synonyms: ['masala dosa', 'dosa', 'dosai'],
      available: false,
      quantity: 0,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen,
      note: 'Batch sold out for today — next prep at 16:00.'
    },
    {
      key: 'paneer-butter-masala',
      kind: 'menu_item',
      description: 'Paneer curry in a mild tomato and butter gravy.',
      synonyms: ['paneer butter masala', 'paneer masala', 'paneer'],
      available: true,
      quantity: 14,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'filter-coffee',
      kind: 'menu_item',
      description: 'South Indian filter coffee.',
      synonyms: ['filter coffee', 'coffee', 'chai', 'tea'],
      available: true,
      quantity: 30,
      unit: 'cups',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'fresh-lime-soda',
      kind: 'menu_item',
      description: 'Chilled lime soda.',
      synonyms: ['lime soda', 'fresh lime soda', 'soda'],
      available: true,
      quantity: 60,
      unit: 'glasses',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'sweet-lime-juice',
      kind: 'menu_item',
      description: 'Seasonal sweet lime juice.',
      synonyms: ['sweet lime', 'sweet lime juice', 'nimbu pani'],
      available: false,
      quantity: 0,
      unit: 'glasses',
      source: CATALOG_SOURCE.canteen,
      note: 'Supplier delivery delayed — restock pending.'
    }
  ],
  'srv-canteen-eng': [
    {
      key: 'veg-thali',
      kind: 'menu_item',
      description: 'Grab-and-go vegetarian thali from the express counter.',
      synonyms: ['veg thali', 'vegetarian thali', 'thali', 'veg platter'],
      available: true,
      quantity: 12,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'masala-dosa',
      kind: 'menu_item',
      description: 'Crisp dosa with potato masala and chutney.',
      synonyms: ['masala dosa', 'dosa', 'dosai'],
      available: true,
      quantity: 9,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'grilled-paneer-sandwich',
      kind: 'menu_item',
      description: 'Warm grilled paneer sandwich.',
      synonyms: ['paneer sandwich', 'grilled sandwich', 'sandwich', 'paneer'],
      available: true,
      quantity: 20,
      unit: 'units',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'artisan-espresso',
      kind: 'menu_item',
      description: 'Single-origin espresso served with biscotti.',
      synonyms: ['espresso', 'artisan espresso', 'coffee'],
      available: true,
      quantity: 45,
      unit: 'cups',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'cold-brew-coffee',
      kind: 'menu_item',
      description: 'Slow-steeped cold brew.',
      synonyms: ['cold brew', 'cold brew coffee', 'iced coffee'],
      available: true,
      quantity: 18,
      unit: 'cups',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'filter-coffee',
      kind: 'menu_item',
      description: 'South Indian filter coffee.',
      synonyms: ['filter coffee', 'coffee', 'chai', 'tea'],
      available: true,
      quantity: 22,
      unit: 'cups',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'veg-biryani',
      kind: 'menu_item',
      description: 'Basmati rice cooked with seasonal vegetables and spices.',
      synonyms: ['veg biryani', 'vegetable biryani', 'biryani'],
      available: true,
      quantity: 7,
      unit: 'portions',
      source: CATALOG_SOURCE.canteen
    },
    {
      key: 'fruit-yogurt-bowl',
      kind: 'menu_item',
      description: 'Seasonal fruit with Greek yogurt and granola.',
      synonyms: ['fruit yogurt', 'yogurt bowl', 'fruit bowl', 'yoghurt'],
      available: false,
      quantity: 0,
      unit: 'bowls',
      source: CATALOG_SOURCE.canteen,
      note: 'Yogurt delivery failed quality check this morning.'
    }
  ],
  'srv-reg-main': [
    {
      key: 'academic-transcript',
      kind: 'document_service',
      description: 'Official sealed academic transcript request.',
      synonyms: ['transcript', 'academic transcript', 'marksheet', 'marks'],
      available: true,
      quantity: 12,
      capacity: 20,
      unit: 'slots',
      reservation: true,
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'student-id-replacement',
      kind: 'document_service',
      description: 'Replacement student identity card.',
      synonyms: ['id card', 'student id', 'replacement id', 'identity card', 'new id card'],
      available: true,
      quantity: 6,
      capacity: 20,
      unit: 'slots',
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'enrollment-verification-letter',
      kind: 'document_service',
      description: 'Signed enrolment verification letter for third parties.',
      synonyms: ['enrollment verification', 'enrolment verification', 'verification letter', 'enrollment letter'],
      available: true,
      quantity: 9,
      capacity: 20,
      unit: 'slots',
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'major-declaration-form',
      kind: 'document_service',
      description: 'Change of major / programme declaration form.',
      synonyms: ['major declaration', 'change of major', 'declare major', 'major change'],
      available: true,
      quantity: 5,
      capacity: 20,
      unit: 'slots',
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'graduation-audit-review',
      kind: 'document_service',
      description: 'Graduation audit review for graduating cohort.',
      synonyms: ['graduation audit', 'graduation review', 'audit review', 'graduation certificate'],
      available: false,
      quantity: 0,
      capacity: 20,
      unit: 'slots',
      source: CATALOG_SOURCE.admin,
      note: 'Paused during the graduation audit backlog — expected to resume next week.'
    }
  ],
  'srv-reg-north': [
    {
      key: 'academic-transcript',
      kind: 'document_service',
      description: 'Express academic transcript request.',
      synonyms: ['transcript', 'academic transcript', 'marksheet', 'marks'],
      available: true,
      quantity: 8,
      capacity: 12,
      unit: 'slots',
      reservation: true,
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'student-id-replacement',
      kind: 'document_service',
      description: 'Replacement student identity card.',
      synonyms: ['id card', 'student id', 'replacement id', 'identity card', 'new id card'],
      available: true,
      quantity: 4,
      capacity: 12,
      unit: 'slots',
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'enrollment-verification-letter',
      kind: 'document_service',
      description: 'Signed enrolment verification letter for third parties.',
      synonyms: ['enrollment verification', 'enrolment verification', 'verification letter', 'enrollment letter'],
      available: true,
      quantity: 7,
      capacity: 12,
      unit: 'slots',
      source: CATALOG_SOURCE.admin
    },
    {
      key: 'major-declaration-form',
      kind: 'document_service',
      description: 'Change of major / programme declaration form.',
      synonyms: ['major declaration', 'change of major', 'declare major', 'major change'],
      available: false,
      quantity: 0,
      capacity: 12,
      unit: 'slots',
      source: CATALOG_SOURCE.admin,
      note: 'Major declaration forms are only processed at the Main Registrar.'
    }
  ],
  'srv-bursar': [
    {
      key: 'tuition-payment-plan',
      kind: 'document_service',
      description: 'Set up or amend a tuition instalment plan.',
      synonyms: ['payment plan', 'tuition plan', 'installment plan', 'instalment plan'],
      available: true,
      quantity: 10,
      capacity: 15,
      unit: 'slots',
      reservation: true,
      source: CATALOG_SOURCE.bursar
    },
    {
      key: 'scholarship-disbursement',
      kind: 'document_service',
      description: 'Scholarship award disbursement and confirmation.',
      synonyms: ['scholarship', 'scholarship disbursement', 'financial aid', 'aid'],
      available: true,
      quantity: 6,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.bursar
    },
    {
      key: 'hold-release-request',
      kind: 'document_service',
      description: 'Registration hold release request.',
      synonyms: ['hold release', 'registration hold', 'remove hold', 'hold'],
      available: true,
      quantity: 4,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.bursar
    },
    {
      key: 'fee-receipt-reprint',
      kind: 'document_service',
      description: 'Reprint of a previous tuition fee receipt.',
      synonyms: ['fee receipt', 'receipt reprint', 'reprint receipt', 'payment receipt'],
      available: false,
      quantity: 0,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.bursar,
      note: 'Reprint service is offline while the billing ledger is reconciled.'
    }
  ],
  'srv-lib-desk': [
    {
      key: 'book-checkout',
      kind: 'resource',
      description: 'Borrow books and return items from the lending collection.',
      synonyms: ['borrow book', 'book checkout', 'check out book', 'library book', 'renew library book', 'renew book'],
      available: true,
      quantity: 50,
      capacity: 50,
      unit: 'items',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'course-reserve-item',
      kind: 'resource',
      description: 'Two-hour course reserve loan from the ground floor desk.',
      synonyms: ['course reserve', 'course reserves', 'reserve item', 'textbook', 'reference book'],
      available: true,
      quantity: 8,
      capacity: 50,
      unit: 'copies',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'inter-library-loan',
      kind: 'document_service',
      description: 'Request a book held by another campus library.',
      synonyms: ['inter library loan', 'interlibrary loan', 'ill'],
      available: true,
      quantity: 3,
      capacity: 50,
      unit: 'requests',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'group-study-room-key',
      kind: 'study_space',
      description: 'Key collection for reservable group study rooms.',
      synonyms: ['study room', 'group study room', 'book a room', 'reserve room', 'study space', 'meeting room'],
      available: false,
      quantity: 0,
      capacity: 12,
      unit: 'rooms',
      reservation: true,
      source: CATALOG_SOURCE.library,
      note: 'All group study rooms are reserved until 18:00 today.'
    },
    {
      key: 'public-pc-terminal',
      kind: 'equipment',
      description: 'Walk-up catalogue and database terminals.',
      synonyms: ['computer', 'public computer', 'pc terminal', 'library computer'],
      available: true,
      quantity: 14,
      capacity: 20,
      unit: 'terminals',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'print-and-scan',
      kind: 'resource',
      description: 'Print, scan and photocopy counter in the ground floor commons.',
      synonyms: ['print document', 'print', 'printing', 'photocopy', 'scan', 'copy'],
      available: true,
      quantity: 3,
      capacity: 3,
      unit: 'jobs',
      source: CATALOG_SOURCE.library
    }
  ],
  'srv-lib-commons': [
    {
      key: 'group-study-room-key',
      kind: 'study_space',
      description: 'Reservable group study rooms with whiteboard and screen.',
      synonyms: ['study room', 'group study room', 'book a room', 'reserve room', 'study space', 'meeting room'],
      available: true,
      quantity: 6,
      capacity: 8,
      unit: 'rooms',
      reservation: true,
      source: CATALOG_SOURCE.library
    },
    {
      key: 'silent-study-carrel',
      kind: 'study_space',
      description: 'Individual silent study carrels on the mezzanine.',
      synonyms: ['silent study', 'carrel', 'quiet study', 'individual study seat', 'study desk'],
      available: true,
      quantity: 21,
      capacity: 32,
      unit: 'seats',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'library-study-desk-seat',
      kind: 'study_space',
      description: 'Open shared study tables.',
      synonyms: ['study desk', 'shared desk', 'study table', 'open seating'],
      available: true,
      quantity: 28,
      capacity: 44,
      unit: 'seats',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'book-checkout',
      kind: 'resource',
      description: 'Borrow books and return items from the lending collection.',
      synonyms: ['borrow book', 'book checkout', 'check out book', 'library book', 'renew library book', 'renew book'],
      available: false,
      quantity: 0,
      capacity: 0,
      unit: 'items',
      source: CATALOG_SOURCE.library,
      note: 'Learning Commons has no lending collection — use the Central Library desk for loans.'
    },
    {
      key: 'public-pc-terminal',
      kind: 'equipment',
      description: 'Walk-up catalogue and database terminals.',
      synonyms: ['computer', 'public computer', 'pc terminal', 'library computer'],
      available: true,
      quantity: 9,
      capacity: 10,
      unit: 'terminals',
      source: CATALOG_SOURCE.library
    },
    {
      key: 'print-and-scan',
      kind: 'resource',
      description: 'Print, scan and photocopy point beside the study commons.',
      synonyms: ['print document', 'print', 'printing', 'photocopy', 'scan', 'copy'],
      available: true,
      quantity: 2,
      capacity: 2,
      unit: 'jobs',
      source: CATALOG_SOURCE.library
    }
  ],
  'srv-sci-lab': [
    {
      key: 'reagent-checkout',
      kind: 'lab_supply',
      description: 'Course reagent requisition and dispensing.',
      synonyms: ['reagent', 'chemicals', 'reagent checkout', 'lab chemical'],
      available: true,
      quantity: 15,
      capacity: 20,
      unit: 'kits',
      source: CATALOG_SOURCE.lab
    },
    {
      key: 'glassware-kit',
      kind: 'lab_supply',
      description: 'Replacement glassware kit for practical sessions.',
      synonyms: ['glassware', 'beaker', 'glassware kit', 'flask'],
      available: false,
      quantity: 0,
      capacity: 20,
      unit: 'kits',
      source: CATALOG_SOURCE.lab,
      note: 'Glassware store audit in progress — no kits issued today.'
    },
    {
      key: 'safety-goggles',
      kind: 'lab_supply',
      description: 'Issued safety goggles and lab coats.',
      synonyms: ['goggles', 'safety goggles', 'lab coat', 'ppe'],
      available: true,
      quantity: 18,
      capacity: 25,
      unit: 'units',
      source: CATALOG_SOURCE.lab
    },
    {
      key: 'lab-notebook',
      kind: 'lab_supply',
      description: 'Issued practical record notebook.',
      synonyms: ['lab notebook', 'notebook', 'practical record'],
      available: true,
      quantity: 22,
      capacity: 25,
      unit: 'notebooks',
      source: CATALOG_SOURCE.lab
    }
  ],
  'srv-eng-workshop': [
    {
      key: 'oscilloscope-checkout',
      kind: 'equipment',
      description: 'Bench oscilloscope checkout for electronics work.',
      synonyms: ['oscilloscope', 'scope', 'bench test', 'electronics'],
      available: true,
      quantity: 4,
      capacity: 6,
      unit: 'units',
      source: CATALOG_SOURCE.maker
    },
    {
      key: 'soldering-station',
      kind: 'equipment',
      description: 'Soldering and rework station bay access.',
      synonyms: ['soldering', 'soldering station', 'rework', 'solder'],
      available: true,
      quantity: 6,
      capacity: 8,
      unit: 'bays',
      source: CATALOG_SOURCE.maker
    },
    {
      key: '3d-print-job',
      kind: 'equipment',
      description: '3D printer job submission and pickup.',
      synonyms: ['3d print', '3d printing', '3d printer', 'print job', 'stl'],
      available: false,
      quantity: 0,
      capacity: 4,
      unit: 'jobs',
      source: CATALOG_SOURCE.maker,
      note: 'All print slots are taken for today — next free slot tomorrow 09:00.'
    },
    {
      key: 'precision-tool-kit',
      kind: 'equipment',
      description: 'Precision hand tool kit checkout.',
      synonyms: ['tool kit', 'precision tools', 'tools', 'screwdriver set'],
      available: true,
      quantity: 7,
      capacity: 10,
      unit: 'kits',
      source: CATALOG_SOURCE.maker
    }
  ],
  'srv-it-helpdesk': [
    {
      key: 'wifi-eduroam-setup',
      kind: 'document_service',
      description: 'Campus Wi-Fi and eduroam device enrolment.',
      synonyms: ['wifi', 'wi fi', 'eduroam', 'internet', 'network setup', 'wifi setup'],
      available: true,
      quantity: 11,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.it
    },
    {
      key: 'mfa-reset',
      kind: 'document_service',
      description: 'Multi-factor authentication device reset.',
      synonyms: ['mfa', 'mfa reset', 'two factor', '2fa', 'authenticator'],
      available: true,
      quantity: 5,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.it
    },
    {
      key: 'loaner-laptop',
      kind: 'equipment',
      description: 'Short-term loaner laptop for students.',
      synonyms: ['loaner laptop', 'borrow laptop', 'laptop loan', 'laptop'],
      available: false,
      quantity: 0,
      capacity: 6,
      unit: 'units',
      source: CATALOG_SOURCE.it,
      note: 'All loaner laptops are issued out — returns expected after 17:00.'
    },
    {
      key: 'software-license-assistance',
      kind: 'document_service',
      description: 'Campus software licence activation and help.',
      synonyms: ['software license', 'licence', 'software', 'activate software'],
      available: true,
      quantity: 8,
      capacity: 15,
      unit: 'slots',
      source: CATALOG_SOURCE.it
    }
  ]
};

function slugItemId(serviceId: string, key: string): string {
  return `itm-${serviceId.replace('srv-', '')}-${key}`;
}

/**
 * Expand the catalogue into stored records for a service.
 * `now` is injected so the seed is deterministic in tests.
 */
export function buildServiceItems(
  serviceId: string,
  serviceName: string,
  now: Date
): ServiceItem[] {
  const entries = SERVICE_CATALOG[serviceId];
  if (!entries) return [];
  const stamp = now.toISOString();
  return entries.map(entry => ({
    id: slugItemId(serviceId, entry.key),
    service_id: serviceId,
    service_name: serviceName,
    kind: entry.kind,
    name: normaliseLabel(entry.key),
    description: entry.description,
    synonyms: entry.synonyms,
    available: entry.available,
    quantity_available: entry.quantity,
    capacity: entry.capacity ?? entry.quantity,
    unit_label: entry.unit,
    requires_reservation: entry.reservation ?? false,
    source_system: entry.source,
    updated_at: stamp,
    updated_by: 'catalogue-seed',
    ...(entry.note ? { unavailability_note: entry.note } : {})
  }));
}

function normaliseLabel(key: string): string {
  return key
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Stable key used to match the same offer across branches. */
export function catalogItemKey(item: ServiceItem): string {
  return item.id.split('-').slice(2).join('-');
}
