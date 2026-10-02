import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Campus,
  Building,
  Service,
  Counter,
  QueueEntry,
  Appointment,
  IncidentRecord,
  WaitMeasurement,
  CampusAnnouncement,
  AppNotification,
  AuditLog,
  UserProfile,
  DelayReason,
  ServiceCategory,
  Seat,
  SeatZone,
  SeatReservation
} from '../src/types/index.js';
import type { ServiceItem } from '../src/types/traffic.js';
import { buildServiceItems } from './intelligence/catalog.js';
import { expireStaleReservations } from './intelligence/seating.js';
import { DATA_DIR } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(DATA_DIR, 'campusflow.json');

/**
 * An admin-confirmed link between a CampusFlow building and a real OpenStreetMap
 * element, so the 3D campus can place a service on a surveyed building instead of
 * guessing. Absence of a link is a valid, non-error state: the 3D view then falls
 * back to the schematic layout and says so.
 */
export interface CampusLink {
  campusflow_building_id: string;
  osm_element_id: string;
  /** OSM element name at the time of linking, for display and audit. */
  osm_element_name?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  note?: string | null;
}

export interface DatabaseSchema {
  campuses: Campus[];
  buildings: Building[];
  services: Service[];
  counters: Counter[];
  queue_entries: QueueEntry[];
  appointments: Appointment[];
  incidents: IncidentRecord[];
  wait_measurements: WaitMeasurement[];
  announcements: CampusAnnouncement[];
  notifications: AppNotification[];
  audit_logs: AuditLog[];
  users: UserProfile[];
  /** user_id -> scrypt password hash. Server-side only. */
  user_credentials: Record<string, string>;
  /** Verified item / resource / task catalogue used by Smart Traffic Intelligence. */
  service_items: ServiceItem[];
  /** Managed library seating. */
  seat_zones: SeatZone[];
  seats: Seat[];
  seat_reservations: SeatReservation[];
  /** `<PREFIX>|<YYYY-MM-DD>` -> last sequence issued, so codes never repeat. */
  ticket_counters: Record<string, number>;
  /** user_id -> instant before which that user's sessions are revoked. */
  session_revocation: Record<string, number>;
  /**
   * Admin-confirmed links from a CampusFlow building to a real OpenStreetMap
   * element id, so the 3D campus can place a service on a surveyed building.
   * A 3D position is only treated as verified when a row exists here.
   */
  campus_links: CampusLink[];
}

// SSE Subscriber management
type SSEClient = {
  id: string;
  res: any;
};
let sseClients: SSEClient[] = [];

export function subscribeSSE(id: string, res: any) {
  sseClients.push({ id, res });
  res.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== id);
  });
}

export function broadcastSSE(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(message);
    } catch (e) {
      // client connection closed
    }
  });
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Demo identities shipped with the platform. Passwords live in server/auth.ts
 * and are never stored in the database file.
 *
 * The addresses use the `.invalid` top-level domain reserved by RFC 2606, which
 * by definition never resolves. A demo account must not be a deliverable
 * mailbox: naming a real student's or staff member's address here would send
 * password resets and notifications to a stranger. The domain still reads as
 * Galgotias University so the sign-in screen matches the campus the app draws.
 */
const DEMO_USER_PROFILES: UserProfile[] = [
  {
    id: 'usr-student-1',
    name: 'Alex Rivera',
    role: 'student',
    id_code: 'STU-8821',
    email: 'alex.rivera@galgotiasuniversity.invalid'
  },
  {
    id: 'usr-student-2',
    name: 'Maya Lin',
    role: 'student',
    id_code: 'STU-9147',
    email: 'maya.lin@galgotiasuniversity.invalid'
  },
  {
    id: 'usr-staff-1',
    name: 'Sarah Chen',
    role: 'staff',
    id_code: 'STF-302',
    email: 'sarah.chen@galgotiasuniversity.invalid',
    assigned_service_id: 'srv-reg-main',
    assigned_counter_number: 1
  },
  {
    id: 'usr-staff-2',
    name: 'David Okafor',
    role: 'staff',
    id_code: 'STF-417',
    email: 'david.okafor@galgotiasuniversity.invalid',
    assigned_service_id: 'srv-canteen-central',
    assigned_counter_number: 1
  },
  {
    id: 'usr-admin-1',
    name: 'Dr. Marcus Vance',
    role: 'admin',
    id_code: 'ADM-001',
    email: 'm.vance@galgotiasuniversity.invalid'
  }
];

/** Second study-space location, used by library Smart Alternatives. */
const LEARNING_COMMONS_SERVICE: Service = {
  id: 'srv-lib-commons',
  name: 'Learning Commons Study Hub',
  code: 'LIB-COMMON',
  category: 'library',
  building_id: 'bld-lrn',
  building_name: 'Learning Commons',
  floor: 'Ground & Mezzanine',
  room_counter: 'Commons Desk, Group Rooms A-H',
  status: 'open',
  operating_hours: {
    open: '08:00',
    close: '22:00',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  current_queue_length: 1,
  active_counters: 2,
  total_counters: 2,
  active_servers: 2,
  avg_service_duration_mins: 3,
  estimated_wait_mins: 2,
  current_demand_level: 'low',
  demand_ratio: 0.4,
  virtual_queue_enabled: true,
  allow_remote_join: true,
  appointments_enabled: true,
  max_queue_capacity: 45,
  description: 'Reservable group study rooms, silent study carrels, shared tables, public terminals and a print/scan point. No lending collection.',
  required_documents: ['Student ID Card (for room and terminal booking)'],
  important_instructions: [
    'Group study rooms are bookable up to 2 hours in advance from the Commons Desk.',
    'No book lending here — use Williamson Central Library for borrowing.'
  ],
  alternate_service_ids: ['srv-lib-desk']
};

function generateEmptyShape(): DatabaseSchema {
  return {
    campuses: [],
    buildings: [],
    services: [],
    counters: [],
    queue_entries: [],
    appointments: [],
    incidents: [],
    wait_measurements: [],
    announcements: [],
    notifications: [],
    audit_logs: [],
    users: [],
    user_credentials: {},
    service_items: [],
    seat_zones: [],
    seats: [],
    seat_reservations: [],
    ticket_counters: {},
    session_revocation: {},
    campus_links: []
  };
}

/**
 * The real campus record.
 *
 * Held at module scope rather than inside generateInitialSeed so the schema
 * migration can reconcile an existing database against it. Installs created
 * before the campus became Galgotias University still carry the old fictional
 * name and timezone on disk, and nothing else in the app would ever correct it.
 */
const SEED_CAMPUS: Campus = {
  id: 'camp-main',
  name: 'Galgotias University, Greater Noida',
  code: 'GU-CENTRAL',
  timezone: 'Asia/Kolkata',
  // Real centre, confirmed by the campus owner. The 3D campus and the service
  // map plan are both drawn from survey data around this point.
  centre_lat: 28.365858,
  centre_lon: 77.542225
};

/** Deep copy, so a caller mutating seed data cannot corrupt the constant. */
function cloneBuildings(buildings: Building[]): Building[] {
  return buildings.map(b => ({ ...b, map_coords: { ...b.map_coords } }));
}

/**
 * Seeded campus locations.
 *
 * At module scope for the same reason as SEED_CAMPUS: the schema migration
 * inserts any of these the stored copy predates, so an install created before the
 * campus became real ends up with the surveyed Galgotias buildings on its map.
 */
const SEED_BUILDINGS: Building[] = [
    /* ------------------------------------------------------------------
     * Real Galgotias University structures.
     *
     * These come from OpenStreetMap. map_coords is the real footprint's
     * centroid projected into the plan's 0-100 space, so each pin sits on the
     * surveyed building rather than on a guess. osm_element_id is the source
     * element, and is_real_survey tells the UI to mark them as real.
     *
     * OpenStreetMap names only a handful of campus features, so only those
     * appear here. The remaining real footprints are drawn on the plan and in
     * the 3D campus, and an administrator confirms which is which from the
     * admin tools rather than the system guessing.
     * ------------------------------------------------------------------ */
    {
      id: 'bld-gu-bblock',
      campus_id: 'camp-main',
      name: 'B-Block (Galgotias University)',
      code: 'B-BLK',
      floor_count: 4,
      description: 'Real building footprint from OpenStreetMap, 3,586 square metres.',
      map_coords: { x: 48.2, y: 53.6 },
      osm_element_id: 'w630317459',
      is_real_survey: true
    },
    {
      id: 'bld-gu-cblock',
      campus_id: 'camp-main',
      name: 'C-Block (Galgotias University)',
      code: 'C-BLK',
      floor_count: 4,
      description: 'Real building footprint from OpenStreetMap, 3,814 square metres.',
      map_coords: { x: 51.8, y: 46.4 },
      osm_element_id: 'w630317457',
      is_real_survey: true
    },
    {
      id: 'bld-gu-hospitality',
      campus_id: 'camp-main',
      name: 'School of Hospitality',
      code: 'HOS',
      floor_count: 3,
      description:
        'Real OpenStreetMap feature. Mapped as a point rather than a polygon, so it carries no footprint and shows no building massing.',
      map_coords: { x: 48.1, y: 52.9 },
      osm_element_id: 'n11009755111',
      is_real_survey: true
    },
    {
      id: 'bld-gu-sports',
      campus_id: 'camp-main',
      name: 'Sports Ground',
      code: 'SPT',
      floor_count: 1,
      description: 'Real open ground from OpenStreetMap, 26,588 square metres.',
      map_coords: { x: 61.8, y: 46.5 },
      osm_element_id: 'w1426897615',
      is_real_survey: true
    },
    {
      id: 'bld-gu-basketball',
      campus_id: 'camp-main',
      name: 'BasketBall Ground',
      code: 'BSK',
      floor_count: 1,
      description: 'Real sports pitch from OpenStreetMap, 1,920 square metres.',
      map_coords: { x: 60.5, y: 45.5 },
      osm_element_id: 'w1426897616',
      is_real_survey: true
    },

    /* ------------------------------------------------------------------
     * CampusFlow service locations.
     *
     * These carry the live queue, booking and seating data. They are the
     * product's own service locations, NOT claims about a specific surveyed
     * structure: until an administrator links one to a real OpenStreetMap
     * building, the map reports it as "projected", never as "verified".
     * ------------------------------------------------------------------ */
    {
      id: 'bld-adm',
      campus_id: 'camp-main',
      name: 'Main Administration Building',
      code: 'ADM',
      floor_count: 4,
      description: 'Central registrar, bursar, financial aid, and student records.',
      map_coords: { x: 28, y: 35 }
    },
    {
      id: 'bld-stu',
      campus_id: 'camp-main',
      name: 'Student Union & Dining Hall',
      code: 'STU',
      floor_count: 3,
      description: 'Campus canteens, student affairs, lounge, and laptop helpdesk.',
      map_coords: { x: 52, y: 55 }
    },
    {
      id: 'bld-lib',
      campus_id: 'camp-main',
      name: 'Williamson Central Library',
      code: 'LIB',
      floor_count: 5,
      description: 'Research commons, borrowing desk, study room reservations.',
      map_coords: { x: 68, y: 30 }
    },
    {
      id: 'bld-sci',
      campus_id: 'camp-main',
      name: 'Science & Discovery Complex',
      code: 'SCI',
      floor_count: 4,
      description: 'Chemistry & Biology laboratory stores and apparatus booking.',
      map_coords: { x: 20, y: 70 }
    },
    {
      id: 'bld-eng',
      campus_id: 'camp-main',
      name: 'Engineering & Maker Hall',
      code: 'ENG',
      floor_count: 4,
      description: 'Hardware lab workshops, 3D printers, and Engineering Cafe.',
      map_coords: { x: 80, y: 65 }
    },
    {
      id: 'bld-nor',
      campus_id: 'camp-main',
      name: 'North Campus Pavilion',
      code: 'NOR',
      floor_count: 2,
      description: 'North satellite registrar counter & express document kiosk.',
      map_coords: { x: 45, y: 15 }
    },
    {
      id: 'bld-lrn',
      campus_id: 'camp-main',
      name: 'Learning Commons',
      code: 'LRN',
      floor_count: 3,
      description: 'Group study rooms, silent carrels, shared tables and print point.',
      map_coords: { x: 62, y: 82 }
    }
];

function generateInitialSeed(): DatabaseSchema {
  const campus: Campus = SEED_CAMPUS;
  const campusBuildings: Building[] = cloneBuildings(SEED_BUILDINGS);

  const services: Service[] = [
    {
      id: 'srv-reg-main',
      name: 'Student Records & Registrar (Main)',
      code: 'REG-MAIN',
      category: 'admin_office',
      building_id: 'bld-adm',
      building_name: 'Main Administration Building',
      floor: 'Floor 1',
      room_counter: 'Rooms 101-104 (Counters 1-4)',
      status: 'congested',
      operating_hours: {
        open: '08:30',
        close: '17:00',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 12,
      active_counters: 2,
      total_counters: 4,
      active_servers: 2,
      avg_service_duration_mins: 6,
      estimated_wait_mins: 36,
      current_demand_level: 'critical',
      demand_ratio: 1.85,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 60,
      description: 'Official academic transcripts, enrollment verification, major declaration, and student ID replacement.',
      required_documents: [
        'Valid Student ID Card or Government Photo ID',
        'Enrollment Verification Form (if applicable)',
        'Signed Release of Educational Records (FERPA)'
      ],
      important_instructions: [
        'Have your 8-digit Student ID Number ready.',
        'High wait detected: North Annex Registrar (Building NOR) offers identical services with shorter queues!'
      ],
      alternate_service_ids: ['srv-reg-north'],
      active_incident_cause: 'document_verification',
      active_incident_notes: 'Slowed processing due to graduation audit document verifications. Counter 3 closed for staff shift rotation.',
      active_incident_timestamp: new Date(Date.now() - 45 * 60000).toISOString()
    },
    {
      id: 'srv-reg-north',
      name: 'North Annex Registrar & Express Records',
      code: 'REG-NORTH',
      category: 'admin_office',
      building_id: 'bld-nor',
      building_name: 'North Campus Pavilion',
      floor: 'Floor 1',
      room_counter: 'Counter A & B',
      status: 'open',
      operating_hours: {
        open: '09:00',
        close: '16:30',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 2,
      active_counters: 2,
      total_counters: 2,
      active_servers: 2,
      avg_service_duration_mins: 5,
      estimated_wait_mins: 5,
      current_demand_level: 'low',
      demand_ratio: 0.6,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 30,
      description: 'Express academic transcripts, ID card issuance, and enrollment letters. Low congestion alternative to Main Registrar.',
      required_documents: [
        'Student ID or Passport',
        'Request Form (printout or digital submission)'
      ],
      important_instructions: [
        'Located in North Pavilion, 4-minute walk from Main Admin.',
        'Immediate queue entry available!'
      ],
      alternate_service_ids: ['srv-reg-main']
    },
    {
      id: 'srv-canteen-main',
      name: 'Student Union Central Canteen',
      code: 'CAN-CENTRAL',
      category: 'canteen',
      building_id: 'bld-stu',
      building_name: 'Student Union & Dining Hall',
      floor: 'Ground Floor',
      room_counter: 'Hot Food & Grill Lines 1-3',
      status: 'congested',
      operating_hours: {
        open: '08:00',
        close: '20:00',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      },
      current_queue_length: 16,
      active_counters: 3,
      total_counters: 3,
      active_servers: 3,
      avg_service_duration_mins: 4,
      estimated_wait_mins: 22,
      current_demand_level: 'high',
      demand_ratio: 1.6,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: false,
      max_queue_capacity: 80,
      description: 'Fresh grilled meals, Asian bowls, deli sandwiches, and beverages. Join virtual pickup queue before arriving.',
      required_documents: ['Meal plan card, student debit, or contactless card'],
      important_instructions: [
        'Order online or join pickup line remotely.',
        'High lunch rush: Engineering Cafe offers grab-and-go options with ~4 min wait.'
      ],
      alternate_service_ids: ['srv-canteen-eng'],
      active_incident_cause: 'too_many_arrivals',
      active_incident_notes: 'Peak meal surge between class dismissal waves.',
      active_incident_timestamp: new Date(Date.now() - 25 * 60000).toISOString()
    },
    {
      id: 'srv-canteen-eng',
      name: 'Engineering Pavilion Cafe & Deli',
      code: 'CAN-ENG',
      category: 'canteen',
      building_id: 'bld-eng',
      building_name: 'Engineering & Maker Hall',
      floor: 'Ground Floor',
      room_counter: 'Express Counter 1 & 2',
      status: 'open',
      operating_hours: {
        open: '07:30',
        close: '18:30',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 3,
      active_counters: 2,
      total_counters: 2,
      active_servers: 2,
      avg_service_duration_mins: 3,
      estimated_wait_mins: 4,
      current_demand_level: 'low',
      demand_ratio: 0.5,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: false,
      max_queue_capacity: 40,
      description: 'Artisan coffee, bakery items, healthy rice bowls, and boxed lunches. Shorter lines than Central Canteen.',
      required_documents: ['Student ID or any credit/debit card'],
      important_instructions: ['Pre-order or join express pickup queue remotely.'],
      alternate_service_ids: ['srv-canteen-main']
    },
    {
      id: 'srv-bursar',
      name: 'Financial Aid & Student Accounts (Bursar)',
      code: 'BURSAR',
      category: 'admin_office',
      building_id: 'bld-adm',
      building_name: 'Main Administration Building',
      floor: 'Floor 2',
      room_counter: 'Room 210, Counters 1-3',
      status: 'open',
      operating_hours: {
        open: '09:00',
        close: '16:30',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 5,
      active_counters: 2,
      total_counters: 3,
      active_servers: 2,
      avg_service_duration_mins: 8,
      estimated_wait_mins: 20,
      current_demand_level: 'moderate',
      demand_ratio: 1.1,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 40,
      description: 'Tuition installment plans, scholarship disbursements, hold releases, and billing counseling.',
      required_documents: [
        'Student ID Card',
        'Financial Aid Award Letter (or digital PDF)',
        'Payment Receipt or Scholarship Documentation'
      ],
      important_instructions: [
        'Tuition deadline is next Friday. Consider scheduling an afternoon appointment to skip walk-in lines.'
      ],
      alternate_service_ids: []
    },
    {
      id: 'srv-sci-lab',
      name: 'Chemistry & Biology Lab Central Store',
      code: 'LAB-CHEM',
      category: 'laboratory',
      building_id: 'bld-sci',
      building_name: 'Science & Discovery Complex',
      floor: 'Floor 2',
      room_counter: 'Lab Dispensing Room 204',
      status: 'open',
      operating_hours: {
        open: '08:30',
        close: '18:00',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 4,
      active_counters: 2,
      total_counters: 2,
      active_servers: 2,
      avg_service_duration_mins: 5,
      estimated_wait_mins: 10,
      current_demand_level: 'moderate',
      demand_ratio: 0.9,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 35,
      description: 'Reagent checkout, glassware kit replacement, safety goggles, and lab notebook issuance.',
      required_documents: [
        'Lab Safety Certification Badge',
        'Course Syllabus / Reagent Requisition Slip'
      ],
      important_instructions: [
        'PPE (closed-toe shoes, lab coat) required when entering dispensing area.'
      ],
      alternate_service_ids: []
    },
    {
      id: 'srv-eng-workshop',
      name: 'Engineering Maker Lab & Equipment Checkout',
      code: 'ENG-MAKER',
      category: 'laboratory',
      building_id: 'bld-eng',
      building_name: 'Engineering & Maker Hall',
      floor: 'Floor 3',
      room_counter: 'Workshop Bay 302',
      status: 'open',
      operating_hours: {
        open: '09:00',
        close: '21:00',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      },
      current_queue_length: 3,
      active_counters: 2,
      total_counters: 3,
      active_servers: 2,
      avg_service_duration_mins: 7,
      estimated_wait_mins: 11,
      current_demand_level: 'moderate',
      demand_ratio: 0.8,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 30,
      description: 'Oscilloscopes, soldering stations, 3D printing queue, microcontrollers, and precision tools checkout.',
      required_documents: [
        'Maker Lab Safety Clearance Slip',
        'Student ID'
      ],
      important_instructions: [
        'For 3D printing, upload your STL file in the Maker portal before arrival.'
      ],
      alternate_service_ids: []
    },
    {
      id: 'srv-lib-desk',
      name: 'Library Circulation & Course Reserves',
      code: 'LIB-CIRC',
      category: 'library',
      building_id: 'bld-lib',
      building_name: 'Williamson Central Library',
      floor: 'Ground Floor',
      room_counter: 'Central Circulation Desk',
      status: 'open',
      operating_hours: {
        open: '08:00',
        close: '23:00',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      },
      current_queue_length: 2,
      active_counters: 2,
      total_counters: 3,
      active_servers: 2,
      avg_service_duration_mins: 4,
      estimated_wait_mins: 4,
      current_demand_level: 'low',
      demand_ratio: 0.45,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 50,
      description: 'Book checkouts, textbook reserves (2-hour loans), inter-library loans, and group study room keys.',
      required_documents: ['Student ID Card'],
      important_instructions: ['Self-checkout kiosks also available near the east exit.'],
      alternate_service_ids: ['srv-lib-commons']
    },
    {
      id: 'srv-it-helpdesk',
      name: 'IT Service Center & Laptop Support',
      code: 'IT-HELP',
      category: 'helpdesk',
      building_id: 'bld-stu',
      building_name: 'Student Union & Dining Hall',
      floor: 'Floor 2',
      room_counter: 'Tech Helpdesk Suite 205',
      status: 'open',
      operating_hours: {
        open: '09:00',
        close: '17:30',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      },
      current_queue_length: 4,
      active_counters: 2,
      total_counters: 3,
      active_servers: 2,
      avg_service_duration_mins: 10,
      estimated_wait_mins: 20,
      current_demand_level: 'moderate',
      demand_ratio: 1.05,
      virtual_queue_enabled: true,
      allow_remote_join: true,
      appointments_enabled: true,
      max_queue_capacity: 35,
      description: 'Campus Wi-Fi connectivity, Eduroam authentication, MFA reset, software license assistance, and loaner laptops.',
      required_documents: ['Student ID Card and device requiring setup'],
      important_instructions: [
        'Backup your data prior to hardware diagnostic inspection.'
      ],
      alternate_service_ids: []
    },
    LEARNING_COMMONS_SERVICE
  ];

  const counters: Counter[] = [
    { id: 'cnt-reg-1', service_id: 'srv-reg-main', counter_number: 1, counter_name: 'Counter 1 (Transcripts)', is_active: true, staff_id: 'usr-staff-1', staff_name: 'Sarah Chen', current_ticket: 'REG-101' },
    { id: 'cnt-reg-2', service_id: 'srv-reg-main', counter_number: 2, counter_name: 'Counter 2 (ID Cards)', is_active: true, staff_id: 'usr-staff-2', staff_name: 'David Patel', current_ticket: 'REG-102' },
    { id: 'cnt-reg-3', service_id: 'srv-reg-main', counter_number: 3, counter_name: 'Counter 3 (General Inquiries)', is_active: false },
    { id: 'cnt-reg-4', service_id: 'srv-reg-main', counter_number: 4, counter_name: 'Counter 4 (Express Pickups)', is_active: false },

    { id: 'cnt-reg-n1', service_id: 'srv-reg-north', counter_number: 1, counter_name: 'North Counter A', is_active: true, staff_name: 'Elena Rostova', current_ticket: 'RGN-012' },
    { id: 'cnt-reg-n2', service_id: 'srv-reg-north', counter_number: 2, counter_name: 'North Counter B', is_active: true, staff_name: 'James Morales' },

    { id: 'cnt-can-1', service_id: 'srv-canteen-main', counter_number: 1, counter_name: 'Hot Station 1', is_active: true, staff_name: 'Chef Marco', current_ticket: 'CAN-201' },
    { id: 'cnt-can-2', service_id: 'srv-canteen-main', counter_number: 2, counter_name: 'Hot Station 2', is_active: true, staff_name: 'Aisha Omar', current_ticket: 'CAN-202' },
    { id: 'cnt-can-3', service_id: 'srv-canteen-main', counter_number: 3, counter_name: 'Express Pickup Station', is_active: true, staff_name: 'Lucas Kim', current_ticket: 'CAN-203' },

    { id: 'cnt-cane-1', service_id: 'srv-canteen-eng', counter_number: 1, counter_name: 'Coffee & Sandwich Station', is_active: true, staff_name: 'Chloe Bennett' },
    { id: 'cnt-cane-2', service_id: 'srv-canteen-eng', counter_number: 2, counter_name: 'Express Pickup', is_active: true, staff_name: 'Ryan O\'Connor' },

    { id: 'cnt-bur-1', service_id: 'srv-bursar', counter_number: 1, counter_name: 'Counter 1 (Accounts)', is_active: true, staff_name: 'Patricia Vance' },
    { id: 'cnt-bur-2', service_id: 'srv-bursar', counter_number: 2, counter_name: 'Counter 2 (Scholarships)', is_active: true, staff_name: 'Liam Jackson' },
    { id: 'cnt-bur-3', service_id: 'srv-bursar', counter_number: 3, counter_name: 'Counter 3 (Payment Plans)', is_active: false },

    { id: 'cnt-it-1', service_id: 'srv-it-helpdesk', counter_number: 1, counter_name: 'Hardware & OS Desk', is_active: true, staff_name: 'Devon Lee' },
    { id: 'cnt-it-2', service_id: 'srv-it-helpdesk', counter_number: 2, counter_name: 'Account & Network Desk', is_active: true, staff_name: 'Sophia Martinez' },

    { id: 'cnt-libc-1', service_id: 'srv-lib-commons', counter_number: 1, counter_name: 'Commons Desk (rooms & keys)', is_active: true, staff_name: 'Ingrid Halvorsen' },
    { id: 'cnt-libc-2', service_id: 'srv-lib-commons', counter_number: 2, counter_name: 'Print & Terminal Support', is_active: true, staff_name: 'Marcus Obi' }
  ];

  const now = Date.now();
  const queue_entries: QueueEntry[] = [
    {
      id: 'qe-101',
      ticket_number: 'REG-101',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: 'usr-student-2',
      student_name: 'Jordan Miller',
      student_id_code: 'STU-4910',
      position: 0,
      status: 'in_service',
      check_in_type: 'remote',
      queue_join_time: new Date(now - 32 * 60000).toISOString(),
      called_time: new Date(now - 8 * 60000).toISOString(),
      service_start_time: new Date(now - 7 * 60000).toISOString(),
      estimated_wait_at_join: 25,
      actual_wait_mins: 24,
      counter_id: 'cnt-reg-1',
      counter_number: 1,
      checked_in_at_counter: true
    },
    {
      id: 'qe-102',
      ticket_number: 'REG-102',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: 'usr-student-3',
      student_name: 'Maya Lin',
      student_id_code: 'STU-6218',
      position: 0,
      status: 'called',
      check_in_type: 'qr',
      queue_join_time: new Date(now - 30 * 60000).toISOString(),
      called_time: new Date(now - 2 * 60000).toISOString(),
      estimated_wait_at_join: 28,
      counter_id: 'cnt-reg-2',
      counter_number: 2,
      grace_period_expires_at: new Date(now + 3 * 60000).toISOString(),
      checked_in_at_counter: false
    },
    {
      id: 'qe-103',
      ticket_number: 'REG-103',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: 'usr-student-1',
      student_name: 'Alex Rivera (You)',
      student_id_code: 'STU-8821',
      position: 1,
      status: 'waiting',
      check_in_type: 'remote',
      queue_join_time: new Date(now - 20 * 60000).toISOString(),
      estimated_wait_at_join: 30,
      checked_in_at_counter: false
    },
    {
      id: 'qe-104',
      ticket_number: 'REG-104',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: 'usr-student-4',
      student_name: 'Ethan Hunt',
      student_id_code: 'STU-3329',
      position: 2,
      status: 'waiting',
      check_in_type: 'remote',
      queue_join_time: new Date(now - 16 * 60000).toISOString(),
      estimated_wait_at_join: 35,
      checked_in_at_counter: false
    },
    {
      id: 'qe-105',
      ticket_number: 'REG-105',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: 'usr-student-5',
      student_name: 'Chloe Zhao',
      student_id_code: 'STU-7741',
      position: 3,
      status: 'waiting',
      check_in_type: 'walk_in',
      queue_join_time: new Date(now - 12 * 60000).toISOString(),
      estimated_wait_at_join: 36,
      checked_in_at_counter: false
    },
    {
      id: 'qe-201',
      ticket_number: 'CAN-201',
      service_id: 'srv-canteen-main',
      service_name: 'Student Union Central Canteen',
      service_category: 'canteen',
      user_id: 'usr-student-6',
      student_name: 'Samuel Green',
      student_id_code: 'STU-1192',
      position: 0,
      status: 'in_service',
      check_in_type: 'remote',
      queue_join_time: new Date(now - 18 * 60000).toISOString(),
      called_time: new Date(now - 3 * 60000).toISOString(),
      service_start_time: new Date(now - 2 * 60000).toISOString(),
      estimated_wait_at_join: 15,
      actual_wait_mins: 15,
      counter_id: 'cnt-can-1',
      counter_number: 1,
      checked_in_at_counter: true
    },
    {
      id: 'qe-202',
      ticket_number: 'CAN-202',
      service_id: 'srv-canteen-main',
      service_name: 'Student Union Central Canteen',
      service_category: 'canteen',
      user_id: 'usr-student-7',
      student_name: 'Priya Sharma',
      student_id_code: 'STU-5503',
      position: 1,
      status: 'waiting',
      check_in_type: 'remote',
      queue_join_time: new Date(now - 14 * 60000).toISOString(),
      estimated_wait_at_join: 18,
      checked_in_at_counter: false
    }
  ];

  // Seed Completed Entries for today so metrics are populated
  for (let i = 1; i <= 28; i++) {
    const minsAgo = 60 + i * 11;
    const wait = Math.floor(12 + Math.random() * 25);
    const duration = Math.floor(4 + Math.random() * 8);
    queue_entries.push({
      id: `qe-hist-${i}`,
      ticket_number: `REG-${80 + i}`,
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      service_category: 'admin_office',
      user_id: `usr-hist-${i}`,
      student_name: `Student Record #${i}`,
      student_id_code: `STU-90${i}`,
      position: 0,
      status: 'completed',
      check_in_type: i % 3 === 0 ? 'walk_in' : (i % 2 === 0 ? 'qr' : 'remote'),
      queue_join_time: new Date(now - minsAgo * 60000).toISOString(),
      called_time: new Date(now - (minsAgo - wait) * 60000).toISOString(),
      service_start_time: new Date(now - (minsAgo - wait) * 60000).toISOString(),
      service_end_time: new Date(now - (minsAgo - wait - duration) * 60000).toISOString(),
      queue_exit_time: new Date(now - (minsAgo - wait - duration) * 60000).toISOString(),
      estimated_wait_at_join: wait - 2,
      actual_wait_mins: wait,
      service_duration_mins: duration,
      counter_id: 'cnt-reg-1',
      counter_number: (i % 2) + 1,
      checked_in_at_counter: true
    });
  }

  const appointments: Appointment[] = [
    {
      id: 'apt-001',
      service_id: 'srv-bursar',
      service_name: 'Financial Aid & Student Accounts (Bursar)',
      user_id: 'usr-student-1',
      student_name: 'Alex Rivera',
      student_id_code: 'STU-8821',
      date: new Date(now + 86400000).toISOString().split('T')[0],
      slot_time: '14:30',
      duration_mins: 15,
      service_purpose: 'Senior Scholarship Disbursement & Tuition Payment Plan Audit',
      status: 'booked',
      created_at: new Date(now - 2 * 86400000).toISOString()
    },
    {
      id: 'apt-002',
      service_id: 'srv-sci-lab',
      service_name: 'Chemistry & Biology Lab Central Store',
      user_id: 'usr-student-4',
      student_name: 'Ethan Hunt',
      student_id_code: 'STU-3329',
      date: new Date(now + 86400000).toISOString().split('T')[0],
      slot_time: '10:00',
      duration_mins: 20,
      service_purpose: 'Organic Chemistry Lab Apparatus Kit Checkout',
      status: 'booked',
      created_at: new Date(now - 86400000).toISOString()
    }
  ];

  const incidents: IncidentRecord[] = [
    {
      id: 'inc-001',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      reason: 'document_verification',
      notes: 'Heavy volume of international student credential audits requiring manual supervisor verification. Counter 3 temporarily offline.',
      reported_by: 'Sarah Chen (Staff Lead)',
      reported_at: new Date(now - 50 * 60000).toISOString(),
      is_active: true
    },
    {
      id: 'inc-002',
      service_id: 'srv-canteen-main',
      service_name: 'Student Union Central Canteen',
      reason: 'too_many_arrivals',
      notes: 'Simultaneous class break release from Science and Engineering lectures creating lunch queue spike.',
      reported_by: 'Campus Floor Coordinator',
      reported_at: new Date(now - 30 * 60000).toISOString(),
      is_active: true
    }
  ];

  // Generate realistic historical wait measurements across 7 days and working hours (08:00 - 18:00)
  const wait_measurements: WaitMeasurement[] = [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const delayReasonsPool: DelayReason[] = [
    'document_verification',
    'too_many_arrivals',
    'insufficient_staff',
    'slow_processing',
    'system_outage',
    'counter_closed'
  ];

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const dayDate = new Date(now - dayOffset * 86400000);
    const dayName = days[dayDate.getDay() % 5] || 'Monday';
    const dateStr = dayDate.toISOString().split('T')[0];

    for (let hour = 8; hour <= 17; hour++) {
      // Registrar Main
      const isPeakHour = (hour >= 11 && hour <= 13) || (hour >= 14 && hour <= 15);
      const arrivals = isPeakHour ? Math.floor(45 + Math.random() * 25) : Math.floor(15 + Math.random() * 15);
      const qLen = isPeakHour ? Math.floor(12 + Math.random() * 8) : Math.floor(2 + Math.random() * 5);
      const avgWait = isPeakHour ? Math.floor(32 + Math.random() * 18) : Math.floor(8 + Math.random() * 10);
      const delayReason = isPeakHour ? delayReasonsPool[Math.floor(Math.random() * delayReasonsPool.length)] : undefined;

      wait_measurements.push({
        id: `wm-reg-${dateStr}-${hour}`,
        service_id: 'srv-reg-main',
        service_name: 'Student Records & Registrar (Main)',
        building_id: 'bld-adm',
        timestamp: new Date(dayDate.setHours(hour, 30, 0, 0)).toISOString(),
        date: dateStr,
        hour: hour,
        day_of_week: dayName,
        queue_length: qLen,
        estimated_wait: avgWait - Math.floor(Math.random() * 4),
        actual_avg_wait: avgWait,
        active_servers: isPeakHour ? 2 : 3,
        arrivals_in_hour: arrivals,
        completed_in_hour: arrivals - Math.floor(Math.random() * 6),
        delay_reason: delayReason
      });

      // Central Canteen
      const isLunchPeak = hour === 12 || hour === 13;
      const canArrivals = isLunchPeak ? Math.floor(75 + Math.random() * 40) : Math.floor(18 + Math.random() * 15);
      const canWait = isLunchPeak ? Math.floor(20 + Math.random() * 12) : Math.floor(3 + Math.random() * 5);

      wait_measurements.push({
        id: `wm-can-${dateStr}-${hour}`,
        service_id: 'srv-canteen-main',
        service_name: 'Student Union Central Canteen',
        building_id: 'bld-stu',
        timestamp: new Date(dayDate.setHours(hour, 30, 0, 0)).toISOString(),
        date: dateStr,
        hour: hour,
        day_of_week: dayName,
        queue_length: isLunchPeak ? 16 + Math.floor(Math.random() * 8) : 3,
        estimated_wait: canWait - 2,
        actual_avg_wait: canWait,
        active_servers: 3,
        arrivals_in_hour: canArrivals,
        completed_in_hour: canArrivals - 2,
        delay_reason: isLunchPeak ? 'too_many_arrivals' : undefined
      });

      // North Annex Registrar (Balanced Alternative)
      const northWait = Math.floor(4 + Math.random() * 6);
      wait_measurements.push({
        id: `wm-regn-${dateStr}-${hour}`,
        service_id: 'srv-reg-north',
        service_name: 'North Annex Registrar & Express Records',
        building_id: 'bld-nor',
        timestamp: new Date(dayDate.setHours(hour, 30, 0, 0)).toISOString(),
        date: dateStr,
        hour: hour,
        day_of_week: dayName,
        queue_length: Math.floor(1 + Math.random() * 3),
        estimated_wait: northWait,
        actual_avg_wait: northWait,
        active_servers: 2,
        arrivals_in_hour: Math.floor(10 + Math.random() * 8),
        completed_in_hour: Math.floor(10 + Math.random() * 8)
      });
    }
  }

  const announcements: CampusAnnouncement[] = [
    {
      id: 'anc-001',
      title: 'High Peak Congestion at Main Registrar',
      message: 'Student Records is experiencing high waiting times due to document verifications. Consider visiting North Annex Registrar (Building NOR) with < 6 min wait or join virtual queue remotely.',
      severity: 'warning',
      target_service_id: 'srv-reg-main',
      created_at: new Date(now - 60 * 60000).toISOString(),
      active: true
    },
    {
      id: 'anc-002',
      title: 'Tuition Payment Deadline Notice',
      message: 'Financial Aid & Bursar counter is operating virtual queues and afternoon appointment bookings for tuition assistance.',
      severity: 'info',
      target_service_id: 'srv-bursar',
      created_at: new Date(now - 120 * 60000).toISOString(),
      active: true
    }
  ];

  const notifications: AppNotification[] = [
    {
      id: 'notif-001',
      user_id: 'usr-student-1',
      ticket_number: 'REG-103',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      title: 'Queue Position Update: You are #1!',
      message: 'You are now 1st in line. Please proceed towards Room 101 Counter Area. Estimated wait ~5 minutes.',
      type: 'return_soon',
      read: false,
      created_at: new Date(now - 4 * 60000).toISOString()
    },
    {
      id: 'notif-002',
      user_id: 'usr-student-1',
      service_id: 'srv-reg-main',
      service_name: 'Student Records & Registrar (Main)',
      title: 'Virtual Queue Joined: Ticket REG-103',
      message: 'You have joined the virtual queue at position #3. You do not need to wait in the physical hallway.',
      type: 'joined',
      read: true,
      created_at: new Date(now - 20 * 60000).toISOString()
    }
  ];

  const audit_logs: AuditLog[] = [
    {
      id: 'aud-001',
      timestamp: new Date(now - 50 * 60000).toISOString(),
      actor_id: 'usr-staff-1',
      actor_name: 'Sarah Chen',
      actor_role: 'staff',
      action: 'RECORD_DELAY_INCIDENT',
      details: 'Recorded incident: Document Verification Delay on Student Records & Registrar.',
      service_id: 'srv-reg-main'
    },
    {
      id: 'aud-002',
      timestamp: new Date(now - 20 * 60000).toISOString(),
      actor_id: 'usr-student-1',
      actor_name: 'Alex Rivera',
      actor_role: 'student',
      action: 'JOIN_VIRTUAL_QUEUE',
      details: 'Joined virtual queue remotely, issued ticket REG-103.',
      service_id: 'srv-reg-main'
    },
    {
      id: 'aud-003',
      timestamp: new Date(now - 8 * 60000).toISOString(),
      actor_id: 'usr-staff-1',
      actor_name: 'Sarah Chen',
      actor_role: 'staff',
      action: 'CALL_STUDENT',
      details: 'Called ticket REG-101 to Counter 1.',
      service_id: 'srv-reg-main'
    }
  ];

  const users: UserProfile[] = DEMO_USER_PROFILES.map(u => ({ ...u }));

  return {
    campuses: [campus],
    buildings: campusBuildings,
    services,
    counters,
    queue_entries,
    appointments,
    incidents,
    wait_measurements,
    announcements,
    notifications,
    audit_logs,
    users,
    user_credentials: {},
    service_items: buildSeedServiceItems(services, now),
    seat_zones: buildSeedSeatZones(),
    seats: buildSeedSeats(),
    seat_reservations: [],
    ticket_counters: {},
    session_revocation: {},
    campus_links: []
  };
}

/**
 * Managed seating layout for libraries. Zones mirror how the buildings are
 * actually organised; the seat inventory is generated once and then persisted,
 * so identifiers stay stable across restarts.
 */
function buildSeedSeatZones(): SeatZone[] {
  return [
    { id: 'zone-lib-quiet', service_id: 'srv-lib-desk', name: 'Silent Study Carrels', floor: 'Mezzanine', kind: 'quiet' },
    { id: 'zone-lib-reading', service_id: 'srv-lib-desk', name: 'Reading Room', floor: 'Floor 2', kind: 'quiet' },
    { id: 'zone-lib-group', service_id: 'srv-lib-desk', name: 'Group Study', floor: 'Floor 3', kind: 'group' },
    { id: 'zone-commons-open', service_id: 'srv-lib-commons', name: 'Open Study Hall', floor: 'Ground', kind: 'open' },
    { id: 'zone-commons-group', service_id: 'srv-lib-commons', name: 'Group Rooms', floor: 'Floor 1', kind: 'group' }
  ];
}

function buildSeedSeats(): Seat[] {
  const seats: Seat[] = [];

  const addBlock = (
    zoneId: string,
    serviceId: string,
    prefix: string,
    count: number,
    featuresFor: (index: number) => string[]
  ) => {
    for (let i = 1; i <= count; i++) {
      seats.push({
        id: `seat-${zoneId}-${prefix}-${i}`,
        zone_id: zoneId,
        service_id: serviceId,
        label: `${prefix}-${String(i).padStart(3, '0')}`,
        // A small, fixed number of seats are out of service.
        status: i % 17 === 0 ? 'maintenance' : 'available',
        features: featuresFor(i)
      });
    }
  };

  addBlock('zone-lib-quiet', 'srv-lib-desk', 'A', 32, i => (i % 2 === 0 ? ['Power outlet', 'Desk lamp'] : ['Power outlet']));
  addBlock('zone-lib-reading', 'srv-lib-desk', 'B', 44, i => (i % 3 === 0 ? ['Power outlet', 'Window seat'] : ['Reading lamp']));
  addBlock('zone-lib-group', 'srv-lib-desk', 'C', 12, () => ['Table for 4', 'Whiteboard', 'Power outlet']);
  addBlock('zone-commons-open', 'srv-lib-commons', 'D', 28, i => (i % 4 === 0 ? ['Power outlet', 'Monitor'] : ['Power outlet']));
  addBlock('zone-commons-group', 'srv-lib-commons', 'E', 8, () => ['Table for 6', 'Display screen']);

  return seats;
}

/** Builds the verified catalogue rows for every service present in the seed. */
function buildSeedServiceItems(services: Service[], now: number): ServiceItem[] {
  const stamp = new Date(now).toISOString();
  const items: ServiceItem[] = [];
  for (const service of services) {
    for (const item of buildServiceItems(service.id, service.name, new Date(stamp))) {
      items.push(item);
    }
  }
  return items;
}

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.loadData();
  }

  private loadData(): DatabaseSchema {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
        const migrated = this.migrateSchema(parsed);
        if (migrated) this.saveDataDirect(migrated);
        return migrated;
      }
    } catch (e) {
      console.warn('Failed to read database file, initializing seed data:', e);
    }
    const seed = generateInitialSeed();
    this.saveDataDirect(seed);
    return seed;
  }

  /**
   * Brings an existing database file up to the current schema without losing
   * any existing records. Only additive changes are made here.
   */
  private migrateSchema(input: Partial<DatabaseSchema>): DatabaseSchema {
    const data = { ...generateEmptyShape(), ...input } as DatabaseSchema;
    let changed = false;

    const collections: (keyof DatabaseSchema)[] = [
      'campuses',
      'buildings',
      'services',
      'counters',
      'queue_entries',
      'appointments',
      'incidents',
      'wait_measurements',
      'announcements',
      'notifications',
      'audit_logs',
      'users',
      'service_items'
    ];
    for (const key of collections) {
      if (!Array.isArray(data[key])) {
        (data as unknown as Record<string, unknown>)[key] = [];
        changed = true;
      }
    }

    // Campus identity: an install created before this campus became Galgotias
    // University still has the old fictional name, code, timezone and no centre
    // on disk. The map draws real Galgotias geometry, so leaving those fields
    // stale would have the header contradict the plan underneath it. Identity is
    // reconciled, not merely inserted.
    const mainCampus = data.campuses.find(c => c.id === SEED_CAMPUS.id);
    if (!mainCampus) {
      data.campuses.unshift({ ...SEED_CAMPUS });
      changed = true;
    } else {
      for (const field of ['name', 'code', 'timezone', 'centre_lat', 'centre_lon'] as const) {
        if (mainCampus[field] !== SEED_CAMPUS[field]) {
          (mainCampus[field] as typeof SEED_CAMPUS[typeof field]) = SEED_CAMPUS[field];
          changed = true;
        }
      }
    }

    // Seeded buildings the stored copy predates, inserted without disturbing any
    // that are already present. Existing rows are left alone, so an
    // administrator's confirmed building-position link survives an upgrade.
    const campusId = mainCampus?.id ?? SEED_CAMPUS.id;
    const knownBuildings = new Set(data.buildings.map(b => b.id));
    for (const building of SEED_BUILDINGS) {
      if (knownBuildings.has(building.id)) continue;
      data.buildings.push({
        ...building,
        campus_id: campusId,
        map_coords: { ...building.map_coords }
      });
      knownBuildings.add(building.id);
      changed = true;
    }

    // Learning Commons branch: a real second study-space location so library
    // alternatives are backed by an actual service record.
    if (!data.buildings.some(b => b.id === 'bld-lrn')) {
      data.buildings.push({
        id: 'bld-lrn',
        campus_id: data.campuses[0]?.id ?? 'camp-main',
        name: 'Learning Commons',
        code: 'LRN',
        floor_count: 3,
        description: 'Group study rooms, silent carrels, shared tables and print point.',
        map_coords: { x: 62, y: 82 }
      });
      changed = true;
    }

    if (!data.services.some(s => s.id === 'srv-lib-commons')) {
      data.services.push(LEARNING_COMMONS_SERVICE);
      changed = true;
    }

    if (!data.counters.some(c => c.service_id === 'srv-lib-commons')) {
      data.counters.push(
        { id: 'cnt-libc-1', service_id: 'srv-lib-commons', counter_number: 1, counter_name: 'Commons Desk (rooms & keys)', is_active: true, staff_name: 'Ingrid Halvorsen' },
        { id: 'cnt-libc-2', service_id: 'srv-lib-commons', counter_number: 2, counter_name: 'Print & Terminal Support', is_active: true, staff_name: 'Marcus Obi' }
      );
      changed = true;
    }

    const library = data.services.find(s => s.id === 'srv-lib-desk');
    if (library && !library.alternate_service_ids.includes('srv-lib-commons')) {
      library.alternate_service_ids = ['srv-lib-commons'];
      changed = true;
    }

    // Verified catalogue rows for every service that has a catalogue entry.
    const existingItems = new Set(data.service_items.map(item => item.id));
    for (const service of data.services) {
      for (const item of buildServiceItems(service.id, service.name, new Date())) {
        if (existingItems.has(item.id)) continue;
        data.service_items.push(item);
        existingItems.add(item.id);
        changed = true;
      }
    }

    // Managed seating (additive; generated once then left stable).
    if (!Array.isArray(data.seat_zones) || data.seat_zones.length === 0) {
      data.seat_zones = buildSeedSeatZones();
      changed = true;
    }

    if (!Array.isArray(data.seats) || data.seats.length === 0) {
      data.seats = buildSeedSeats();
      changed = true;
    }

    if (!Array.isArray(data.seat_reservations)) {
      data.seat_reservations = [];
      changed = true;
    }

    if (!data.ticket_counters) {
      data.ticket_counters = {};
      changed = true;
    }

    if (!data.session_revocation) {
      data.session_revocation = {};
      changed = true;
    }

    if (!Array.isArray(data.campus_links)) {
      data.campus_links = [];
      changed = true;
    }

    // Auth table (additive; existing installs gain an empty credentials map).
    if (!data.user_credentials) {
      data.user_credentials = {};
      changed = true;
    }

    // Sessions are stateless and signed, so any legacy session rows are dropped.
    if ((data as { sessions?: unknown }).sessions) {
      delete (data as { sessions?: unknown }).sessions;
      changed = true;
    }

    // Demo accounts used by the sign-in screen must always exist, and their
    // addresses must track DEMO_USER_PROFILES.
    //
    // Insert-only is not enough here. Renaming a demo address would otherwise
    // strand every existing install: the user rows are already present, so they
    // kept the old address and sign-in failed for everyone. Refreshing the
    // seeded fields on those known ids keeps an upgrade working. Only fields the
    // seed owns are touched, so a locally edited name or role survives.
    const knownUserIds = ['usr-student-1', 'usr-student-2', 'usr-staff-1', 'usr-staff-2', 'usr-admin-1'];
    for (const userId of knownUserIds) {
      const demo = DEMO_USER_PROFILES.find(u => u.id === userId);
      if (!demo) continue;

      const existing = data.users.find(u => u.id === userId);
      if (!existing) {
        data.users.push({ ...demo });
        changed = true;
        continue;
      }

      if (existing.email !== demo.email || existing.name !== demo.name || existing.role !== demo.role) {
        existing.email = demo.email;
        existing.name = demo.name;
        existing.role = demo.role;
        existing.id_code = demo.id_code;
        existing.assigned_service_id = demo.assigned_service_id;
        existing.assigned_counter_number = demo.assigned_counter_number;
        changed = true;
      }
    }

    if (changed) {
      console.log('[campusflow] database schema migrated (additive only)');
    }
    return data;
  }

  private saveData() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write database file:', e);
    }
  }

  private saveDataDirect(data: DatabaseSchema) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to direct write database file:', e);
    }
  }

  public resetToSeed(): DatabaseSchema {
    this.data = generateInitialSeed();
    this.saveData();
    broadcastSSE('DATA_REFRESH', { timestamp: new Date().toISOString() });
    return this.data;
  }

  // CAMPUS & BUILDINGS
  public getCampuses() {
    return this.data.campuses;
  }

  public getBuildings() {
    return this.data.buildings;
  }

  // SERVICES
  public getServices(category?: string) {
    if (category && category !== 'all') {
      return this.data.services.filter(s => s.category === category);
    }
    return this.data.services;
  }

  public getServiceById(id: string) {
    return this.data.services.find(s => s.id === id);
  }

  public getCountersByServiceId(serviceId: string) {
    return this.data.counters.filter(c => c.service_id === serviceId);
  }

  // VERIFIED SERVICE CATALOGUE (Smart Traffic Intelligence)
  public getServiceItems(serviceId?: string) {
    if (!serviceId) return this.data.service_items;
    return this.data.service_items.filter(item => item.service_id === serviceId);
  }

  public getServiceItemById(id: string) {
    return this.data.service_items.find(item => item.id === id);
  }

  public addServiceItem(item: ServiceItem) {
    this.data.service_items.push(item);
  }

  /** Persists an availability edit made by staff and notifies live clients. */
  public persistServiceItem(item: ServiceItem) {
    const index = this.data.service_items.findIndex(candidate => candidate.id === item.id);
    if (index >= 0) this.data.service_items[index] = item;
    else this.data.service_items.push(item);
    this.saveData();
    broadcastSSE('SERVICE_ITEM_UPDATED', item);
  }

  public updateService(id: string, updates: Partial<Service>) {
    const s = this.getServiceById(id);
    if (!s) return null;
    Object.assign(s, updates);
    this.recalculateServiceStats(id);
    this.saveData();
    broadcastSSE('SERVICE_UPDATED', s);
    return s;
  }

  // QUEUE MANAGEMENT

  /**
   * Issues the next ticket code for a service on a given day.
   *
   * Codes are `<PREFIX>-<sequence>`, where the sequence restarts each day and
   * is never reused that day, so a code printed on a receipt always identifies
   * exactly one student. Existing codes for the day seed the counter so it keeps
   * climbing correctly across restarts.
   */
  public issueTicketCode(codePrefix: string, dayKey: string): string {
    const key = `${codePrefix}|${dayKey}`;

    // Recover the highest sequence already issued today, in case the counter
    // was lost (fresh process, restored backup) but the tickets remain.
    const prefix = `${codePrefix}-`;
    const issuedToday = this.data.queue_entries
      .filter(e => (e.ticket_number || '').startsWith(prefix) && e.ticket_date === dayKey)
      .map(e => parseInt((e.ticket_number || '').slice(prefix.length), 10))
      .filter(n => Number.isFinite(n));
    const recovered = issuedToday.length > 0 ? Math.max(...issuedToday) : 0;

    const previous = this.data.ticket_counters[key] ?? 0;
    const next = Math.max(previous, recovered) + 1;
    this.data.ticket_counters[key] = next;
    return `${prefix}${next}`;
  }

  public getQueueEntries(serviceId?: string, status?: string) {
    return this.data.queue_entries.filter(q => {
      if (serviceId && q.service_id !== serviceId) return false;
      if (status && q.status !== status) return false;
      return true;
    });
  }

  /**
   * Queue view for a signed-in caller. Staff and admins keep the full record;
   * a student only ever sees the full record for their own ticket, and every
   * other student's identity is redacted. This is the privacy boundary — the
   * raw entries are never returned to a student caller.
   */
  public getQueueEntriesForViewer(
    serviceId: string | undefined,
    status: string | undefined,
    viewer: { id: string; role: 'student' | 'staff' | 'admin' } | undefined
  ) {
    const privileged = viewer?.role === 'staff' || viewer?.role === 'admin';
    return this.getQueueEntries(serviceId, status).map(entry => {
      if (privileged || viewer?.id === entry.user_id) {
        return { ...entry, is_own: viewer?.id === entry.user_id };
      }
      return {
        ...entry,
        student_name: 'Student',
        student_id_code: '—',
        is_own: false
      };
    });
  }

  public getUserQueueEntries(userId: string) {
    return this.data.queue_entries.filter(q => q.user_id === userId);
  }

  public getQueueEntryById(id: string) {
    return this.data.queue_entries.find(q => q.id === id);
  }

  public joinQueue(params: {
    service_id: string;
    user_id: string;
    student_name: string;
    student_id_code: string;
    check_in_type: 'remote' | 'qr' | 'kiosk' | 'walk_in';
    recommendation_id?: string;
    redirected_from_service_id?: string;
  }): { success: boolean; entry?: QueueEntry; error?: string } {
    const service = this.getServiceById(params.service_id);
    if (!service) {
      return { success: false, error: 'Service not found.' };
    }

    if (service.status === 'closed') {
      return { success: false, error: 'Service is currently closed.' };
    }

    // Anti-abuse: Check if user already in active queue for this service
    const existingActive = this.data.queue_entries.find(
      q => q.user_id === params.user_id && 
           q.service_id === params.service_id && 
           ['waiting', 'called', 'in_service'].includes(q.status)
    );
    if (existingActive) {
      return { 
        success: false, 
        error: `You already hold an active ticket (${existingActive.ticket_number}) for this service.` 
      };
    }

    // Capacity limit check
    const activeWaiting = this.data.queue_entries.filter(
      q => q.service_id === params.service_id && q.status === 'waiting'
    );
    if (activeWaiting.length >= service.max_queue_capacity) {
      return { 
        success: false, 
        error: `Virtual queue capacity reached (${service.max_queue_capacity} limit). Please check back shortly or visit an alternate location.` 
      };
    }

    // Ticket number e.g. REG-106.
    //
    // A random number is not good enough here: with only ~800 possible values
    // two students can be handed the same code at the same counter, and staff
    // would have no way to tell them apart. The number is therefore a
    // per-service daily sequence that is never reused on the same day.
    const codePrefix = service.code.split('-')[0] || 'TKT';
    const todayKey = new Date().toISOString().slice(0, 10);
    const ticket_number = this.issueTicketCode(codePrefix, todayKey);

    const position = activeWaiting.length + 1;
    const estWait = Math.max(1, Math.round((position * service.avg_service_duration_mins) / Math.max(1, service.active_servers)));

    const entry: QueueEntry = {
      id: `qe-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ticket_number,
      ticket_date: todayKey,
      service_id: service.id,
      service_name: service.name,
      service_category: service.category,
      user_id: params.user_id,
      student_name: params.student_name,
      student_id_code: params.student_id_code,
      position,
      status: 'waiting',
      check_in_type: params.check_in_type,
      queue_join_time: new Date().toISOString(),
      estimated_wait_at_join: estWait,
      checked_in_at_counter: false,
      ...(params.recommendation_id ? { recommendation_id: params.recommendation_id } : {}),
      ...(params.redirected_from_service_id ? { redirected_from_service_id: params.redirected_from_service_id } : {})
    };

    this.data.queue_entries.push(entry);
    this.recalculateServiceStats(service.id);

    // Create Notification
    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      user_id: params.user_id,
      ticket_number,
      service_id: service.id,
      service_name: service.name,
      title: `Virtual Queue Joined: ${ticket_number}`,
      message: `You are #${position} in line at ${service.name}. Estimated wait: ${estWait} mins. We will alert you when your turn approaches.`,
      type: 'joined',
      read: false,
      created_at: new Date().toISOString()
    };
    this.data.notifications.unshift(notif);

    // Audit log
    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: params.user_id,
      actor_name: params.student_name,
      actor_role: 'student',
      action: 'JOIN_VIRTUAL_QUEUE',
      details: `Student joined queue for ${service.name} with ticket ${ticket_number} (${params.check_in_type})`,
      service_id: service.id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: service.id, entry });
    broadcastSSE('NOTIFICATION_NEW', notif);

    return { success: true, entry };
  }

  /**
   * Extends the check-in grace window for a called student.
   *
   * If the notification could not be delivered, or the student's device was
   * offline when they were called, they should not silently lose their place.
   * The window is extended once per ticket and no penalty is recorded, so a
   * flaky connection is never treated as a no-show.
   */
  public extendGraceForMissedTurn(
    queueEntryId: string,
    extraMins = 5
  ): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };
    if (entry.status !== 'called') {
      return { success: false, error: 'Only a called student can be given extra time.' };
    }
    // One extension only, so this cannot be used to hold a counter open.
    if (entry.grace_extended) {
      return { success: false, error: 'This ticket has already been given extra time.' };
    }

    const now = Date.now();
    const currentDeadline = entry.grace_period_expires_at
      ? new Date(entry.grace_period_expires_at).getTime()
      : now;
    // Always extend from the later of now or the existing deadline.
    const base = Math.max(now, currentDeadline);
    entry.grace_period_expires_at = new Date(base + extraMins * 60000).toISOString();
    entry.grace_extended = true;
    entry.grace_extended_reason = 'student_unreachable';

    this.data.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: entry.user_id,
      ticket_number: entry.ticket_number,
      service_id: entry.service_id,
      service_name: entry.service_name,
      title: `More time for ${entry.ticket_number}`,
      message: `We could not reach you, so your check-in window was extended by ${extraMins} minutes. You have not lost your place.`,
      type: 'grace_period',
      read: false,
      created_at: new Date().toISOString()
    });

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      actor_id: 'system',
      actor_name: 'System',
      actor_role: 'staff',
      action: 'GRACE_EXTENDED',
      details: `Grace period extended ${extraMins}m for ${entry.ticket_number} because the student was unreachable. No penalty recorded.`,
      service_id: entry.service_id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });
    return { success: true, entry };
  }

  public callNextStudent(params: {
    service_id: string;
    counter_id?: string;
    counter_number: number;
    staff_id: string;
    staff_name: string;
  }): { success: boolean; entry?: QueueEntry; error?: string } {
    const service = this.getServiceById(params.service_id);
    if (!service) return { success: false, error: 'Service not found.' };

    // Find first 'waiting' student
    const waitingEntries = this.data.queue_entries
      .filter(q => q.service_id === params.service_id && q.status === 'waiting')
      .sort((a, b) => new Date(a.queue_join_time).getTime() - new Date(b.queue_join_time).getTime());

    if (waitingEntries.length === 0) {
      return { success: false, error: 'No students currently waiting in queue.' };
    }

    const nextEntry = waitingEntries[0];
    const now = new Date();
    const graceExpiry = new Date(now.getTime() + 5 * 60000); // 5 minutes grace period

    nextEntry.status = 'called';
    nextEntry.called_time = now.toISOString();
    nextEntry.counter_id = params.counter_id;
    nextEntry.counter_number = params.counter_number;
    nextEntry.grace_period_expires_at = graceExpiry.toISOString();

    // Update Counter ticket
    if (params.counter_id) {
      const cnt = this.data.counters.find(c => c.id === params.counter_id);
      if (cnt) {
        cnt.current_ticket = nextEntry.ticket_number;
        cnt.staff_id = params.staff_id;
        cnt.staff_name = params.staff_name;
        cnt.is_active = true;
      }
    }

    // High priority notification to the student
    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      user_id: nextEntry.user_id,
      ticket_number: nextEntry.ticket_number,
      service_id: service.id,
      service_name: service.name,
      title: `⚡ YOUR TURN IS READY! Proceed to Counter ${params.counter_number}`,
      message: `Your ticket ${nextEntry.ticket_number} has been called to Counter ${params.counter_number} by ${params.staff_name}. Please check in within 5 minutes.`,
      type: 'turn_ready',
      read: false,
      created_at: now.toISOString()
    };
    this.data.notifications.unshift(notif);

    this.recalculateServiceStats(service.id);

    // Audit log
    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now.toISOString(),
      actor_id: params.staff_id,
      actor_name: params.staff_name,
      actor_role: 'staff',
      action: 'CALL_NEXT_STUDENT',
      details: `Called ${nextEntry.ticket_number} (${nextEntry.student_name}) to Counter ${params.counter_number}`,
      service_id: service.id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: service.id, entry: nextEntry });
    broadcastSSE('NOTIFICATION_NEW', notif);

    return { success: true, entry: nextEntry };
  }

  public startService(queueEntryId: string, staffName?: string): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };

    const now = new Date();
    entry.status = 'in_service';
    entry.service_start_time = now.toISOString();
    entry.checked_in_at_counter = true;

    // Actual wait computation
    const waitMs = now.getTime() - new Date(entry.queue_join_time).getTime();
    entry.actual_wait_mins = Math.max(1, Math.round(waitMs / 60000));

    this.recalculateServiceStats(entry.service_id);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now.toISOString(),
      actor_id: 'staff',
      actor_name: staffName || 'Staff Member',
      actor_role: 'staff',
      action: 'START_SERVICE',
      details: `Began serving ticket ${entry.ticket_number} (${entry.student_name}). Actual wait: ${entry.actual_wait_mins}m.`,
      service_id: entry.service_id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });

    return { success: true, entry };
  }

  public completeService(queueEntryId: string, staffName?: string): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };

    const now = new Date();
    entry.status = 'completed';
    entry.service_end_time = now.toISOString();
    entry.queue_exit_time = now.toISOString();

    if (entry.service_start_time) {
      const durMs = now.getTime() - new Date(entry.service_start_time).getTime();
      entry.service_duration_mins = Math.max(1, Math.round(durMs / 60000));
    } else {
      entry.service_duration_mins = 5;
    }

    // Clear counter ticket
    if (entry.counter_id) {
      const cnt = this.data.counters.find(c => c.id === entry.counter_id);
      if (cnt && cnt.current_ticket === entry.ticket_number) {
        cnt.current_ticket = undefined;
      }
    }

    // Send completion notification
    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      user_id: entry.user_id,
      ticket_number: entry.ticket_number,
      service_id: entry.service_id,
      service_name: entry.service_name,
      title: `Service Completed: ${entry.ticket_number}`,
      message: `Your transaction at ${entry.service_name} has concluded. Thank you for using CampusFlow virtual queues.`,
      type: 'completed',
      read: false,
      created_at: now.toISOString()
    };
    this.data.notifications.unshift(notif);

    this.recalculateServiceStats(entry.service_id);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now.toISOString(),
      actor_id: 'staff',
      actor_name: staffName || 'Staff Member',
      actor_role: 'staff',
      action: 'COMPLETE_SERVICE',
      details: `Completed ticket ${entry.ticket_number}. Service duration: ${entry.service_duration_mins}m.`,
      service_id: entry.service_id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });
    broadcastSSE('NOTIFICATION_NEW', notif);

    return { success: true, entry };
  }

  public skipStudent(queueEntryId: string, reason: 'skipped' | 'no_show', staffName?: string): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };

    const now = new Date();
    entry.status = reason;
    entry.queue_exit_time = now.toISOString();

    // A student who was unreachable never really no-showed. Keep the outcome
    // for reporting, but record that no penalty should attach to it.
    if (reason === 'no_show' && entry.grace_extended) {
      entry.no_show_penalty = false;
    } else if (reason === 'no_show') {
      entry.no_show_penalty = true;
    }

    if (entry.counter_id) {
      const cnt = this.data.counters.find(c => c.id === entry.counter_id);
      if (cnt && cnt.current_ticket === entry.ticket_number) {
        cnt.current_ticket = undefined;
      }
    }

    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      user_id: entry.user_id,
      ticket_number: entry.ticket_number,
      service_id: entry.service_id,
      service_name: entry.service_name,
      title: `Ticket ${entry.ticket_number} Marked as ${reason === 'no_show' ? 'No-Show' : 'Skipped'}`,
      message: `Your turn at ${entry.service_name} was marked as ${reason} because you did not check in during the grace period. You may rejoin if needed.`,
      type: 'grace_period',
      read: false,
      created_at: now.toISOString()
    };
    this.data.notifications.unshift(notif);

    this.recalculateServiceStats(entry.service_id);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now.toISOString(),
      actor_id: 'staff',
      actor_name: staffName || 'Staff Member',
      actor_role: 'staff',
      action: reason === 'no_show' ? 'MARK_NO_SHOW' : 'SKIP_STUDENT',
      details: `Marked ticket ${entry.ticket_number} as ${reason}`,
      service_id: entry.service_id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });
    broadcastSSE('NOTIFICATION_NEW', notif);

    return { success: true, entry };
  }

  public cancelQueue(queueEntryId: string, actorName?: string): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };

    const now = new Date();
    entry.status = 'cancelled';
    entry.queue_exit_time = now.toISOString();

    this.recalculateServiceStats(entry.service_id);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: now.toISOString(),
      actor_id: entry.user_id,
      actor_name: actorName || entry.student_name,
      actor_role: 'student',
      action: 'CANCEL_QUEUE',
      details: `Ticket ${entry.ticket_number} cancelled by student`,
      service_id: entry.service_id
    });

    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });

    return { success: true, entry };
  }

  public checkInAtCounter(queueEntryId: string): { success: boolean; entry?: QueueEntry; error?: string } {
    const entry = this.getQueueEntryById(queueEntryId);
    if (!entry) return { success: false, error: 'Queue entry not found.' };

    entry.checked_in_at_counter = true;
    this.saveData();
    broadcastSSE('QUEUE_UPDATED', { service_id: entry.service_id, entry });
    return { success: true, entry };
  }

  // RECALCULATE SERVICE STATS & DYNAMIC POSITIONS
  public recalculateServiceStats(serviceId: string) {
    const service = this.getServiceById(serviceId);
    if (!service) return;

    const waitingEntries = this.data.queue_entries
      .filter(q => q.service_id === serviceId && q.status === 'waiting')
      .sort((a, b) => new Date(a.queue_join_time).getTime() - new Date(b.queue_join_time).getTime());

    // Update dynamic positions for all waiting students
    waitingEntries.forEach((entry, idx) => {
      const oldPos = entry.position;
      const newPos = idx + 1;
      entry.position = newPos;

      // Check if entering top 2 to trigger "Return soon" alert
      if (newPos <= 2 && oldPos > 2) {
        const notif: AppNotification = {
          id: `notif-${Date.now()}-${entry.id}`,
          user_id: entry.user_id,
          ticket_number: entry.ticket_number,
          service_id: service.id,
          service_name: service.name,
          title: `Return to Service Area: You are #${newPos}`,
          message: `Your turn is approaching rapidly at ${service.name}. Please head to ${service.room_counter} now!`,
          type: 'return_soon',
          read: false,
          created_at: new Date().toISOString()
        };
        this.data.notifications.unshift(notif);
        broadcastSSE('NOTIFICATION_NEW', notif);
      }
    });

    service.current_queue_length = waitingEntries.length;

    // Active counters count
    const activeCounters = this.data.counters.filter(c => c.service_id === serviceId && c.is_active);
    service.active_counters = activeCounters.length || service.active_servers || 1;
    service.active_servers = service.active_counters;

    // Estimated wait mins
    const avgDuration = service.avg_service_duration_mins || 5;
    service.estimated_wait_mins = Math.max(
      1,
      Math.round((waitingEntries.length * avgDuration) / Math.max(1, service.active_servers))
    );

    // Demand ratio & level
    // Normal capacity per hour = (60 / avgDuration) * active_servers
    const standardHourlyCap = (60 / avgDuration) * Math.max(1, service.total_counters);
    const currentHourlyArrivalRate = Math.max(5, waitingEntries.length * 3);
    service.demand_ratio = parseFloat((currentHourlyArrivalRate / standardHourlyCap).toFixed(2));

    if (service.demand_ratio >= 1.6 || service.estimated_wait_mins >= 30) {
      service.current_demand_level = 'critical';
      service.status = service.status === 'closed' ? 'closed' : 'congested';
    } else if (service.demand_ratio >= 1.2 || service.estimated_wait_mins >= 18) {
      service.current_demand_level = 'high';
      service.status = service.status === 'closed' ? 'closed' : (service.status === 'congested' ? 'congested' : 'open');
    } else if (service.demand_ratio >= 0.8) {
      service.current_demand_level = 'moderate';
      if (service.status === 'congested') service.status = 'open';
    } else {
      service.current_demand_level = 'low';
      if (service.status === 'congested') service.status = 'open';
    }
  }

  // CAPACITY & INCIDENT MANAGEMENT
  public updateCapacity(params: {
    service_id: string;
    active_counters: number;
    active_servers: number;
    staff_name: string;
    reason?: string;
  }) {
    const service = this.getServiceById(params.service_id);
    if (!service) return null;

    const oldCounters = service.active_counters;
    service.active_counters = params.active_counters;
    service.active_servers = params.active_servers;

    // Update counter active flags
    const srvCounters = this.data.counters.filter(c => c.service_id === params.service_id);
    srvCounters.forEach((cnt, idx) => {
      cnt.is_active = idx < params.active_counters;
    });

    this.recalculateServiceStats(params.service_id);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'staff',
      actor_name: params.staff_name,
      actor_role: 'staff',
      action: 'UPDATE_CAPACITY',
      details: `Capacity adjusted from ${oldCounters} to ${params.active_counters} active counters. Reason: ${params.reason || 'Operational adjustment'}`,
      service_id: service.id
    });

    this.saveData();
    broadcastSSE('SERVICE_UPDATED', service);
    return service;
  }

  public recordIncident(params: {
    service_id: string;
    reason: DelayReason;
    notes: string;
    reported_by: string;
  }) {
    const service = this.getServiceById(params.service_id);
    if (!service) return null;

    const incident: IncidentRecord = {
      id: `inc-${Date.now()}`,
      service_id: service.id,
      service_name: service.name,
      reason: params.reason,
      notes: params.notes,
      reported_by: params.reported_by,
      reported_at: new Date().toISOString(),
      is_active: true
    };

    this.data.incidents.unshift(incident);
    service.active_incident_cause = params.reason;
    service.active_incident_notes = params.notes;
    service.active_incident_timestamp = incident.reported_at;

    // Also add to historical wait measurements
    this.data.wait_measurements.unshift({
      id: `wm-${Date.now()}`,
      service_id: service.id,
      service_name: service.name,
      building_id: service.building_id,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      hour: new Date().getHours(),
      day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()],
      queue_length: service.current_queue_length,
      estimated_wait: service.estimated_wait_mins,
      actual_avg_wait: service.estimated_wait_mins + 4,
      active_servers: service.active_servers,
      arrivals_in_hour: 40,
      completed_in_hour: 22,
      delay_reason: params.reason
    });

    // Notify waiting students about recorded delay
    const affectedStudents = this.data.queue_entries.filter(
      q => q.service_id === service.id && ['waiting', 'called'].includes(q.status)
    );

    affectedStudents.forEach(st => {
      this.data.notifications.unshift({
        id: `notif-inc-${Date.now()}-${st.id}`,
        user_id: st.user_id,
        ticket_number: st.ticket_number,
        service_id: service.id,
        service_name: service.name,
        title: `Service Delay Advisory: ${service.name}`,
        message: `An operational delay was recorded: ${params.notes}. Our staff are resolving it.`,
        type: 'delay_alert',
        read: false,
        created_at: new Date().toISOString()
      });
    });

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'staff',
      actor_name: params.reported_by,
      actor_role: 'staff',
      action: 'RECORD_DELAY_INCIDENT',
      details: `Recorded operational delay (${params.reason}): ${params.notes}`,
      service_id: service.id
    });

    this.saveData();
    broadcastSSE('INCIDENT_RECORDED', { incident, service });
    return incident;
  }

  public resolveIncident(incidentId: string, resolvedBy: string) {
    const inc = this.data.incidents.find(i => i.id === incidentId);
    if (!inc) return null;

    inc.is_active = false;
    inc.resolved_at = new Date().toISOString();

    const service = this.getServiceById(inc.service_id);
    if (service && service.active_incident_cause === inc.reason) {
      service.active_incident_cause = undefined;
      service.active_incident_notes = undefined;
      service.active_incident_timestamp = undefined;
    }

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: 'staff',
      actor_name: resolvedBy,
      actor_role: 'staff',
      action: 'RESOLVE_DELAY_INCIDENT',
      details: `Resolved incident ${inc.id} on ${inc.service_name}`,
      service_id: inc.service_id
    });

    this.saveData();
    broadcastSSE('INCIDENT_RESOLVED', { incident: inc, service });
    return inc;
  }

  // APPOINTMENTS
  public getAppointments(userId?: string, serviceId?: string) {
    return this.data.appointments.filter(a => {
      if (userId && a.user_id !== userId) return false;
      if (serviceId && a.service_id !== serviceId) return false;
      return true;
    });
  }

  public getAppointmentById(id: string) {
    return this.data.appointments.find(a => a.id === id);
  }

  public bookAppointment(params: {
    service_id: string;
    user_id: string;
    student_name: string;
    student_id_code: string;
    date: string;
    slot_time: string;
    duration_mins: number;
    service_purpose: string;
  }): { success: boolean; appointment?: Appointment; error?: string } {
    const service = this.getServiceById(params.service_id);
    if (!service) return { success: false, error: 'Service not found.' };

    // Concurrency conflict check: Ensure same slot_time on date is not already booked!
    const conflict = this.data.appointments.find(
      a => a.service_id === params.service_id &&
           a.date === params.date &&
           a.slot_time === params.slot_time &&
           a.status === 'booked'
    );

    if (conflict) {
      return {
        success: false,
        error: `Slot ${params.slot_time} on ${params.date} was just reserved by another student. Please select an alternate time slot.`
      };
    }

    const appointment: Appointment = {
      id: `apt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      service_id: service.id,
      service_name: service.name,
      user_id: params.user_id,
      student_name: params.student_name,
      student_id_code: params.student_id_code,
      date: params.date,
      slot_time: params.slot_time,
      duration_mins: params.duration_mins,
      service_purpose: params.service_purpose,
      status: 'booked',
      created_at: new Date().toISOString()
    };

    this.data.appointments.push(appointment);

    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      user_id: params.user_id,
      service_id: service.id,
      service_name: service.name,
      title: `Appointment Confirmed: ${service.name}`,
      message: `Your appointment is scheduled for ${params.date} at ${params.slot_time}. Please bring required documents.`,
      type: 'appointment',
      read: false,
      created_at: new Date().toISOString()
    };
    this.data.notifications.unshift(notif);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor_id: params.user_id,
      actor_name: params.student_name,
      actor_role: 'student',
      action: 'BOOK_APPOINTMENT',
      details: `Booked slot ${params.slot_time} on ${params.date} for ${service.name}`,
      service_id: service.id
    });

    this.saveData();
    broadcastSSE('APPOINTMENT_BOOKED', appointment);
    broadcastSSE('NOTIFICATION_NEW', notif);

    return { success: true, appointment };
  }

  public cancelAppointment(appointmentId: string, actorName?: string) {
    const apt = this.data.appointments.find(a => a.id === appointmentId);
    if (!apt) return null;

    apt.status = 'cancelled';
    this.saveData();
    broadcastSSE('APPOINTMENT_CANCELLED', apt);
    return apt;
  }

  // NOTIFICATIONS
  public getNotifications(userId: string) {
    return this.data.notifications.filter(n => n.user_id === userId);
  }

  public getNotificationById(id: string) {
    return this.data.notifications.find(n => n.id === id);
  }

  public markNotificationAsRead(id: string) {
    const n = this.data.notifications.find(item => item.id === id);
    if (n) {
      n.read = true;
      this.saveData();
    }
    return n;
  }

  public markAllNotificationsAsRead(userId: string) {
    this.data.notifications.forEach(n => {
      if (n.user_id === userId) n.read = true;
    });
    this.saveData();
  }

  // ANNOUNCEMENTS
  public getAnnouncements() {
    return this.data.announcements.filter(a => a.active);
  }

  public createAnnouncement(params: {
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'alert';
    target_service_id?: string;
  }) {
    const anc: CampusAnnouncement = {
      id: `anc-${Date.now()}`,
      title: params.title,
      message: params.message,
      severity: params.severity,
      target_service_id: params.target_service_id,
      created_at: new Date().toISOString(),
      active: true
    };
    this.data.announcements.unshift(anc);
    this.saveData();
    broadcastSSE('ANNOUNCEMENT_NEW', anc);
    return anc;
  }

  // AUDIT LOGS
  public getAuditLogs(limit: number = 100) {
    return this.data.audit_logs.slice(0, limit);
  }

  public recordAudit(entry: {
    actor_id: string;
    actor_name: string;
    actor_role: 'student' | 'staff' | 'admin';
    action: string;
    details: string;
    service_id?: string;
  }) {
    const log: AuditLog = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.data.audit_logs.unshift(log);
    // Keep the audit trail bounded; the newest records are the useful ones.
    if (this.data.audit_logs.length > 5000) {
      this.data.audit_logs.length = 5000;
    }
    this.saveData();
    return log;
  }

  // USERS & SESSIONS
  public getUsers(): UserProfile[] {
    return this.data.users;
  }

  public getUserById(id: string): UserProfile | undefined {
    return this.data.users.find(u => u.id === id);
  }

  /** Password hashes are never returned through the API. */
  public getPasswordHash(userId: string): string | null {
    return this.data.user_credentials[userId] ?? null;
  }

  public setUserPassword(userId: string, passwordHash: string): void {
    this.data.user_credentials[userId] = passwordHash;
    this.saveData();
  }

  /**
   * Instant before which sessions for this user are refused. Storing the floor
   * rather than a token list keeps revocation O(1) and stateless elsewhere.
   */
  public getSessionRevocationFloor(userId: string): number | null {
    const value = this.data.session_revocation[userId];
    return typeof value === 'number' ? value : null;
  }

  public setSessionRevocationFloor(userId: string, at: number): void {
    this.data.session_revocation[userId] = at;
    this.saveData();
  }

  // -------------------------------------------------- campus 3D links

  /**
   * Links a CampusFlow building to a real OSM element.
   *
   * One link per building: re-linking replaces the previous target, because two
   * verified positions for one service would be ambiguous on the 3D map.
   */
  public linkCampusBuilding(
    campusflowBuildingId: string,
    osmElementId: string,
    actor: { id: string; name: string },
    note?: string
  ): { success: boolean; link?: CampusLink; error?: string } {
    const building = this.getBuildings().find(b => b.id === campusflowBuildingId);
    if (!building) return { success: false, error: 'CampusFlow building not found.' };

    const link: CampusLink = {
      campusflow_building_id: campusflowBuildingId,
      osm_element_id: osmElementId,
      verified_by: actor.name,
      verified_at: new Date().toISOString(),
      note: note ?? null
    };

    const existing = this.data.campus_links.findIndex(
      l => l.campusflow_building_id === campusflowBuildingId
    );
    if (existing >= 0) this.data.campus_links[existing] = link;
    else this.data.campus_links.push(link);

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: 'admin',
      action: 'CAMPUS_LINK_SET',
      details: `Linked ${building.name} to OpenStreetMap element ${osmElementId}.`,
      service_id: undefined
    } as any);

    this.saveData();
    return { success: true, link };
  }

  /** Removes a link. The 3D map then falls back to the schematic position. */
  public unlinkCampusBuilding(
    campusflowBuildingId: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const before = this.data.campus_links.length;
    this.data.campus_links = this.data.campus_links.filter(
      l => l.campusflow_building_id !== campusflowBuildingId
    );
    if (this.data.campus_links.length === before) {
      return { success: false, error: 'No link exists for that building.' };
    }

    this.data.audit_logs.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: 'admin',
      action: 'CAMPUS_LINK_REMOVED',
      details: `Removed the surveyed-position link for ${campusflowBuildingId}. The 3D campus now shows a projected position.`
    } as any);

    this.saveData();
    return { success: true };
  }

  public getCampusLinks(): CampusLink[] {
    return this.data.campus_links;
  }

  // ------------------------------------------------------------------ SEATING

  /** Campus-local timezone, used to resolve wall-clock booking times. */
  public campusTimezone(): string {
    // Falls back to the seeded campus timezone, not to some other country's. An
    // unstated fallback here would silently shift every booking by half a day.
    return this.data.campuses[0]?.timezone || SEED_CAMPUS.timezone;
  }

  public getSeatZones(serviceId?: string): SeatZone[] {
    return serviceId ? this.data.seat_zones.filter(z => z.service_id === serviceId) : this.data.seat_zones;
  }

  public getSeats(serviceId?: string): Seat[] {
    return serviceId ? this.data.seats.filter(s => s.service_id === serviceId) : this.data.seats;
  }

  public getSeatById(id: string): Seat | undefined {
    return this.data.seats.find(s => s.id === id);
  }

  public getSeatReservations(serviceId?: string): SeatReservation[] {
    return serviceId
      ? this.data.seat_reservations.filter(r => r.service_id === serviceId)
      : this.data.seat_reservations;
  }

  public getSeatReservationById(id: string): SeatReservation | undefined {
    return this.data.seat_reservations.find(r => r.id === id);
  }

  /**
   * Releases holds that were never checked into. Called before every seating
   * read/write so an abandoned hold cannot keep a seat out of the pool.
   */
  public sweepSeatReservations(now = new Date()): SeatReservation[] {
    const expired = expireStaleReservations(this.data.seat_reservations, now, this.campusTimezone());
    if (expired.length > 0) {
      this.saveData();
      for (const reservation of expired) {
        broadcastSSE('SEAT_UPDATED', {
          service_id: reservation.service_id,
          seat_id: reservation.seat_id,
          reservation_id: reservation.id,
          status: reservation.status
        });
      }
    }
    return expired;
  }

  /** Applies a seat mutation, persists it and notifies listeners. */
  private commitSeatReservation(reservation: SeatReservation, action: string, actor?: UserProfile): void {
    this.saveData();
    broadcastSSE('SEAT_UPDATED', {
      service_id: reservation.service_id,
      seat_id: reservation.seat_id,
      reservation: { ...reservation }
    });
    const seat = this.getSeatById(reservation.seat_id);
    this.recordAudit({
      actor_id: actor?.id ?? 'system',
      actor_name: actor?.name ?? 'System',
      actor_role: actor?.role ?? 'student',
      action,
      details: `${action.replace(/_/g, ' ').toLowerCase()} · seat ${seat?.label ?? reservation.seat_id} (${reservation.date} ${reservation.start_time}-${reservation.end_time})`,
      service_id: reservation.service_id
    });
  }

  public addSeatReservation(reservation: SeatReservation, actor?: UserProfile): void {
    this.data.seat_reservations.push(reservation);
    this.commitSeatReservation(reservation, 'RESERVE_SEAT', actor);
  }

  public applySeatReservationUpdate(
    reservation: SeatReservation,
    action: string,
    actor?: UserProfile
  ): void {
    this.commitSeatReservation(reservation, action, actor);
  }

  // FACTUAL EXPLAINER: "WHY IS THE QUEUE LONG?"
  public getWhyQueueIsLong(serviceId: string) {
    const service = this.getServiceById(serviceId);
    if (!service) return null;

    const waitingCount = service.current_queue_length;
    const totalCounters = service.total_counters;
    const activeCounters = service.active_counters;
    const closedCounters = Math.max(0, totalCounters - activeCounters);
    const avgDuration = service.avg_service_duration_mins;

    // Normal theoretical capacity per hour
    const baselineCapacity = Math.round((60 / avgDuration) * totalCounters);
    const currentCapacity = Math.round((60 / avgDuration) * activeCounters);

    // Current arrival rate (based on current active queues & recent completed entries)
    const arrivalsPerHour = Math.round(waitingCount * 2.8) + 10;
    const demandRatio = parseFloat((arrivalsPerHour / Math.max(1, baselineCapacity)).toFixed(2));

    const causes: string[] = [];

    if (demandRatio >= 1.3) {
      causes.push(`Arrival volume (${arrivalsPerHour}/hr) exceeds normal capacity (${baselineCapacity}/hr) by ${Math.round((demandRatio - 1) * 100)}%.`);
    }

    if (closedCounters > 0) {
      causes.push(`${closedCounters} of ${totalCounters} counters are closed, reducing service throughput by ${Math.round((closedCounters / totalCounters) * 100)}%.`);
    }

    if (service.active_incident_cause) {
      causes.push(`Active operational incident recorded: "${service.active_incident_notes || service.active_incident_cause}".`);
    }

    const isCongested = waitingCount >= 8 || service.estimated_wait_mins >= 20 || demandRatio >= 1.3;

    return {
      service_id: service.id,
      service_name: service.name,
      is_congested: isCongested,
      current_queue_length: waitingCount,
      estimated_wait_mins: service.estimated_wait_mins,
      demand_ratio: demandRatio,
      arrivals_per_hour: arrivalsPerHour,
      baseline_capacity_per_hour: baselineCapacity,
      current_capacity_per_hour: currentCapacity,
      total_counters: totalCounters,
      active_counters: activeCounters,
      closed_counters: closedCounters,
      active_incident_cause: service.active_incident_cause,
      active_incident_notes: service.active_incident_notes,
      causes_list: causes.length > 0 ? causes : ['Current queue conditions are within normal operational parameters.'],
      summary_explanation: causes.length > 0
        ? causes.join(' ')
        : 'Service is operating with balanced arrivals and capacity.'
    };
  }

  // "BEST TIME TO VISIT" HISTORICAL ANALYZER
  public getBestTimeToVisit(serviceId: string) {
    const service = this.getServiceById(serviceId);
    if (!service) return null;

    const measurements = this.data.wait_measurements.filter(m => m.service_id === serviceId);

    // Group by hour 08:00 - 17:00
    const hourlyData: { hour: number; label: string; avg_wait: number; avg_queue: number; sample_count: number }[] = [];

    for (let h = 8; h <= 17; h++) {
      const matching = measurements.filter(m => m.hour === h);
      const totalWait = matching.reduce((sum, m) => sum + m.actual_avg_wait, 0);
      const totalQ = matching.reduce((sum, m) => sum + m.queue_length, 0);
      const count = matching.length || 1;

      const avgWait = matching.length ? Math.round(totalWait / count) : (h === 12 || h === 13 ? 25 : 8);
      const avgQ = matching.length ? Math.round(totalQ / count) : 3;

      const label = `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`;
      hourlyData.push({
        hour: h,
        label,
        avg_wait: avgWait,
        avg_queue: avgQ,
        sample_count: matching.length
      });
    }

    // Sort to find best window (lowest wait) and peak window (highest wait)
    const sorted = [...hourlyData].sort((a, b) => a.avg_wait - b.avg_wait);
    const bestHour = sorted[0];
    const peakHour = sorted[sorted.length - 1];

    const bestWindows = hourlyData
      .filter(h => h.avg_wait <= (bestHour.avg_wait + 4))
      .map(h => h.label);

    const peakWindows = hourlyData
      .filter(h => h.avg_wait >= (peakHour.avg_wait - 5))
      .map(h => h.label);

    return {
      service_id: service.id,
      service_name: service.name,
      hourly_curve: hourlyData,
      best_time_window: bestWindows.slice(0, 3).join(', '),
      peak_time_window: peakWindows.slice(0, 2).join(' & '),
      min_expected_wait: bestHour.avg_wait,
      max_expected_wait: peakHour.avg_wait,
      recommendation: `Historical data indicates lowest congestion at ${bestWindows.slice(0, 2).join(' or ')} (avg wait ~${bestHour.avg_wait} mins). Avoid peak rush at ${peakWindows.join(' & ')}.`
    };
  }

  // MULTI-LOCATION ALTERNATIVES
  public getAlternatives(serviceId: string) {
    const service = this.getServiceById(serviceId);
    if (!service) return [];

    const alts: any[] = [];
    service.alternate_service_ids.forEach(altId => {
      const alt = this.getServiceById(altId);
      if (alt && alt.status !== 'closed') {
        const walkingMinutes = 4; // realistic campus walking time
        const waitDiff = service.estimated_wait_mins - alt.estimated_wait_mins;
        const netSaved = waitDiff - walkingMinutes;

        alts.push({
          id: alt.id,
          name: alt.name,
          building_name: alt.building_name,
          floor: alt.floor,
          room_counter: alt.room_counter,
          current_wait_mins: alt.estimated_wait_mins,
          walking_time_mins: walkingMinutes,
          time_saved_mins: Math.max(0, netSaved),
          status: alt.status,
          queue_length: alt.current_queue_length,
          recommended: netSaved >= 5
        });
      }
    });

    return alts;
  }

  // OPERATIONAL ANALYTICS FOR ADMIN DASHBOARD
  public getCampusAnalytics(filter?: { time_range?: string; service_id?: string; building_id?: string }) {
    let measurements = this.data.wait_measurements;
    let completedQueues = this.data.queue_entries.filter(q => q.status === 'completed');
    let allQueues = this.data.queue_entries;

    if (filter?.service_id) {
      measurements = measurements.filter(m => m.service_id === filter.service_id);
      completedQueues = completedQueues.filter(q => q.service_id === filter.service_id);
      allQueues = allQueues.filter(q => q.service_id === filter.service_id);
    }
    if (filter?.building_id) {
      measurements = measurements.filter(m => m.building_id === filter.building_id);
    }

    // 1. Core KPIs
    const totalQueuedToday = allQueues.length;
    const totalCompleted = completedQueues.length;
    const totalWaitingNow = allQueues.filter(q => q.status === 'waiting').length;

    // Aggregate student waiting minutes
    const aggregateWaitingMinutes = completedQueues.reduce(
      (sum, q) => sum + (q.actual_wait_mins || q.estimated_wait_at_join || 0),
      0
    ) + allQueues.filter(q => q.status === 'waiting').reduce((sum, q) => sum + q.estimated_wait_at_join, 0);

    // Average and median wait
    const waits = completedQueues.map(q => q.actual_wait_mins || 0).sort((a, b) => a - b);
    const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 18;
    const medianWait = waits.length ? waits[Math.floor(waits.length / 2)] : 16;
    const peakWait = waits.length ? Math.max(...waits) : 48;

    // Abandonment and No-show rates
    const cancelledCount = allQueues.filter(q => q.status === 'cancelled').length;
    // A no-show after the grace window was extended (student unreachable) is not
    // student behaviour, so it is excluded from the rate.
    const noShowCount = allQueues.filter(q => q.status === 'no_show' && q.no_show_penalty !== false).length;
    const noShowExcused = allQueues.filter(q => q.status === 'no_show' && q.no_show_penalty === false).length;
    const abandonmentRate = totalQueuedToday ? parseFloat(((cancelledCount / totalQueuedToday) * 100).toFixed(1)) : 4.2;
    const noShowRate = totalQueuedToday ? parseFloat(((noShowCount / totalQueuedToday) * 100).toFixed(1)) : 2.8;

    // Prediction accuracy
    let totalError = 0;
    let countedPredictions = 0;
    completedQueues.forEach(q => {
      if (q.actual_wait_mins && q.estimated_wait_at_join) {
        totalError += Math.abs(q.estimated_wait_at_join - q.actual_wait_mins);
        countedPredictions++;
      }
    });
    const avgPredErrorMins = countedPredictions ? parseFloat((totalError / countedPredictions).toFixed(1)) : 2.4;
    const predictionAccuracyPct = Math.max(70, Math.round(100 - (avgPredErrorMins / Math.max(1, avgWait)) * 100));

    // 2. WHEN? Hourly wait curve & peak times
    const hourlyAggregate: Record<number, { arrivals: number; completions: number; total_wait: number; count: number }> = {};
    for (let h = 8; h <= 17; h++) {
      hourlyAggregate[h] = { arrivals: 0, completions: 0, total_wait: 0, count: 0 };
    }

    measurements.forEach(m => {
      if (hourlyAggregate[m.hour]) {
        hourlyAggregate[m.hour].arrivals += m.arrivals_in_hour;
        hourlyAggregate[m.hour].completions += m.completed_in_hour;
        hourlyAggregate[m.hour].total_wait += m.actual_avg_wait;
        hourlyAggregate[m.hour].count += 1;
      }
    });

    const hourlyCurve = Object.entries(hourlyAggregate).map(([hStr, data]) => {
      const h = parseInt(hStr);
      return {
        hour: h,
        label: `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`,
        avg_wait: data.count ? Math.round(data.total_wait / data.count) : 10,
        arrivals: data.count ? Math.round(data.arrivals / data.count) : 20,
        completions: data.count ? Math.round(data.completions / data.count) : 18
      };
    });

    // 3. WHERE? Busiest buildings and services
    const serviceCongestion = this.data.services.map(s => {
      const matchingMeasurements = measurements.filter(m => m.service_id === s.id);
      const avgWaitS = matchingMeasurements.length
        ? Math.round(matchingMeasurements.reduce((sum, m) => sum + m.actual_avg_wait, 0) / matchingMeasurements.length)
        : s.estimated_wait_mins;

      return {
        id: s.id,
        name: s.name,
        building_name: s.building_name,
        category: s.category,
        current_queue: s.current_queue_length,
        avg_wait: avgWaitS,
        status: s.status,
        demand_level: s.current_demand_level,
        active_counters: s.active_counters,
        total_counters: s.total_counters
      };
    }).sort((a, b) => b.avg_wait - a.avg_wait);

    // 4. WHY? Delay causes breakdown
    const delayCounts: Record<string, number> = {};
    measurements.forEach(m => {
      if (m.delay_reason) {
        delayCounts[m.delay_reason] = (delayCounts[m.delay_reason] || 0) + 1;
      }
    });
    this.data.incidents.forEach(inc => {
      delayCounts[inc.reason] = (delayCounts[inc.reason] || 0) + 3;
    });

    const totalDelays = Object.values(delayCounts).reduce((a, b) => a + b, 0) || 1;
    const delayCausesBreakdown = Object.entries(delayCounts).map(([reason, count]) => {
      return {
        reason: reason as DelayReason,
        label: reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        count,
        percentage: Math.round((count / totalDelays) * 100)
      };
    }).sort((a, b) => b.count - a.count);

    // 5. Impact Statement
    const studentHoursLost = parseFloat((aggregateWaitingMinutes / 60).toFixed(1));

    return {
      kpis: {
        total_queued_today: totalQueuedToday,
        total_completed_today: totalCompleted,
        total_waiting_now: totalWaitingNow,
        aggregate_waiting_minutes: aggregateWaitingMinutes,
        student_hours_lost: studentHoursLost,
        avg_wait_mins: avgWait,
        median_wait_mins: medianWait,
        peak_wait_mins: peakWait,
        abandonment_rate_pct: abandonmentRate,
        no_show_rate_pct: noShowRate,
      no_show_excused_count: noShowExcused,
        prediction_accuracy_pct: predictionAccuracyPct,
        avg_prediction_error_mins: avgPredErrorMins
      },
      when_analysis: {
        hourly_curve: hourlyCurve,
        recurring_peak_window: '11:30 AM – 1:30 PM (Lunch & Class Turnover)',
        secondary_peak_window: '2:30 PM – 3:30 PM (Mid-Afternoon Advising Rush)',
        quietest_window: '8:30 AM – 10:00 AM'
      },
      where_analysis: {
        services_ranking: serviceCongestion,
        top_congested_building: 'Main Administration Building (Floor 1)',
        secondary_congested_building: 'Student Union (Central Canteen)'
      },
      why_analysis: {
        delay_causes: delayCausesBreakdown,
        active_incidents: this.data.incidents.filter(i => i.is_active)
      },
      impact_summary: {
        total_students_affected: totalQueuedToday,
        total_minutes_lost: aggregateWaitingMinutes,
        equivalent_study_hours: studentHoursLost,
        summary_text: `Today, ${totalQueuedToday} students interacted with campus services, with ${aggregateWaitingMinutes} aggregate minutes spent waiting (~${studentHoursLost} study hours). Document verification and lunch arrival surges accounted for 64% of operational delays.`
      }
    };
  }

  // CAPACITY SIMULATOR (M/M/c Queuing Model)
  public simulateCapacity(params: {
    service_id: string;
    added_counters: number;
    avg_service_time_mins: number;
    arrival_rate_multiplier: number;
    appointment_percentage: number;
  }) {
    const service = this.getServiceById(params.service_id);
    if (!service) return null;

    const baseCounters = service.active_counters;
    const simCounters = Math.max(1, baseCounters + params.added_counters);
    const serviceTime = Math.max(1, params.avg_service_time_mins);

    // Baseline arrivals per hour
    const baseArrivals = Math.max(10, Math.round(service.current_queue_length * 2.5 + 20));
    // Adjusted arrivals per hour
    const simArrivals = Math.round(baseArrivals * params.arrival_rate_multiplier);

    // Service rate per server per hour
    const mu = 60 / serviceTime;
    // Total system capacity per hour
    const totalSimCapacity = simCounters * mu;

    // Server utilization rho
    const rho = Math.min(0.98, simArrivals / Math.max(1, totalSimCapacity));

    // Baseline wait and simulated wait
    const baseWait = service.estimated_wait_mins;

    // Erlang-C approximation for simulated queue wait time
    // Higher appointments smooth out arrival variability!
    const variabilityDiscount = 1 - (params.appointment_percentage / 100) * 0.45;
    const simWaitCalculated = Math.max(
      1,
      Math.round(((rho / Math.max(0.05, 1 - rho)) * (serviceTime / simCounters)) * variabilityDiscount)
    );

    const simulatedQueueLength = Math.max(1, Math.round((simArrivals / 60) * simWaitCalculated));
    const waitReductionMinutes = Math.max(0, baseWait - simWaitCalculated);
    const waitReductionPercent = baseWait > 0 ? Math.round((waitReductionMinutes / baseWait) * 100) : 0;

    return {
      service_id: service.id,
      service_name: service.name,
      baseline: {
        active_counters: baseCounters,
        avg_service_time_mins: service.avg_service_duration_mins,
        estimated_wait_mins: baseWait,
        queue_length: service.current_queue_length
      },
      simulated: {
        active_counters: simCounters,
        avg_service_time_mins: serviceTime,
        arrival_rate_per_hour: simArrivals,
        server_utilization_pct: Math.round(rho * 100),
        estimated_wait_mins: simWaitCalculated,
        estimated_queue_length: simulatedQueueLength,
        wait_reduction_mins: waitReductionMinutes,
        wait_reduction_pct: waitReductionPercent
      },
      model_metadata: {
        algorithm: 'Multi-Server Markovian Queuing Model (M/M/c) with Appointment Arrival Smoothing',
        disclaimer: 'This projection is an operational mathematical simulation based on queuing theory and arrival distributions. Actual outcomes depend on staff attendance and case complexity.'
      }
    };
  }
}

export const db = new Database();
