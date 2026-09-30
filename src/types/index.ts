export type ServiceCategory = 
  | 'canteen' 
  | 'admin_office' 
  | 'laboratory' 
  | 'library' 
  | 'helpdesk' 
  | 'student_counter';

export type DelayReason = 
  | 'insufficient_staff'
  | 'too_many_arrivals'
  | 'slow_processing'
  | 'system_outage'
  | 'payment_problem'
  | 'document_verification'
  | 'equipment_unavailable'
  | 'laboratory_preparation'
  | 'network_issue'
  | 'counter_closed'
  | 'unexpected_demand'
  | 'other';

export const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  insufficient_staff: 'Insufficient Staff on Duty',
  too_many_arrivals: 'High Arrival Volume / Demand Spike',
  slow_processing: 'Complex Case / Slow Processing',
  system_outage: 'Campus System Outage / Slowdown',
  payment_problem: 'Payment Gateway / Cashier Issue',
  document_verification: 'Document Verification Delay',
  equipment_unavailable: 'Equipment / Hardware Unavailable',
  laboratory_preparation: 'Laboratory Chemical/Apparatus Prep',
  network_issue: 'Network / Wi-Fi Connectivity Issue',
  counter_closed: 'Counter Maintenance / Staff Break',
  unexpected_demand: 'Unscheduled Surge / Group Arrival',
  other: 'Other Operational Delay',
};

export interface Campus {
  id: string;
  name: string;
  code: string;
  timezone: string;
}

export interface Building {
  id: string;
  campus_id: string;
  name: string;
  code: string;
  floor_count: number;
  description: string;
  map_coords: {
    x: number; // percentage on SVG map
    y: number;
    svg_path?: string;
  };
}

export interface Counter {
  id: string;
  service_id: string;
  counter_number: number;
  counter_name: string;
  is_active: boolean;
  staff_id?: string;
  staff_name?: string;
  current_ticket?: string;
}

export interface Service {
  id: string;
  name: string;
  code: string;
  category: ServiceCategory;
  building_id: string;
  building_name: string;
  floor: string;
  room_counter: string;
  status: 'open' | 'closed' | 'paused' | 'congested';
  operating_hours: {
    open: string;
    close: string;
    days: string[];
  };
  current_queue_length: number;
  active_counters: number;
  total_counters: number;
  active_servers: number;
  avg_service_duration_mins: number;
  estimated_wait_mins: number;
  current_demand_level: 'low' | 'moderate' | 'high' | 'critical';
  demand_ratio: number; // arrivals per hour / capacity per hour
  virtual_queue_enabled: boolean;
  allow_remote_join: boolean;
  appointments_enabled: boolean;
  max_queue_capacity: number;
  description: string;
  required_documents: string[];
  important_instructions: string[];
  alternate_service_ids: string[];
  active_incident_cause?: DelayReason;
  active_incident_notes?: string;
  active_incident_timestamp?: string;
}

export type QueueStatus = 
  | 'waiting' 
  | 'called' 
  | 'in_service' 
  | 'completed' 
  | 'skipped' 
  | 'cancelled' 
  | 'no_show';

export type CheckInType = 'remote' | 'qr' | 'kiosk' | 'walk_in';

export interface QueueEntry {
  id: string;
  ticket_number: string;
  /** Local campus day the code was issued (YYYY-MM-DD); codes restart daily. */
  ticket_date?: string;
  service_id: string;
  service_name: string;
  service_category: ServiceCategory;
  user_id: string;
  student_name: string;
  student_id_code: string;
  position: number;
  status: QueueStatus;
  check_in_type: CheckInType;
  queue_join_time: string;
  called_time?: string;
  service_start_time?: string;
  service_end_time?: string;
  queue_exit_time?: string;
  estimated_wait_at_join: number;
  actual_wait_mins?: number;
  service_duration_mins?: number;
  counter_id?: string;
  counter_number?: number;
  grace_period_expires_at?: string;
  /** True once the grace window has been extended because the student was unreachable. */
  grace_extended?: boolean;
  /** Why the window was extended; 'student_unreachable' means no penalty applies. */
  grace_extended_reason?: 'student_unreachable';
  /**
   * Whether a no-show should count against the student. False when the grace
   * window had already been extended because they were unreachable.
   */
  no_show_penalty?: boolean;
  checked_in_at_counter: boolean;
  /** Set when the student arrived here via a Smart Traffic recommendation. */
  recommendation_id?: string;
  redirected_from_service_id?: string;
}

export interface Appointment {
  id: string;
  service_id: string;
  service_name: string;
  user_id: string;
  student_name: string;
  student_id_code: string;
  date: string; // YYYY-MM-DD
  slot_time: string; // HH:mm
  duration_mins: number;
  service_purpose: string;
  status: 'booked' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  created_at: string;
}

export interface IncidentRecord {
  id: string;
  service_id: string;
  service_name: string;
  reason: DelayReason;
  notes: string;
  reported_by: string;
  reported_at: string;
  resolved_at?: string;
  is_active: boolean;
}

export interface WaitMeasurement {
  id: string;
  service_id: string;
  service_name: string;
  building_id: string;
  timestamp: string;
  date: string;
  hour: number;
  day_of_week: string;
  queue_length: number;
  estimated_wait: number;
  actual_avg_wait: number;
  active_servers: number;
  arrivals_in_hour: number;
  completed_in_hour: number;
  delay_reason?: DelayReason;
}

export interface CampusAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'alert';
  target_service_id?: string;
  created_at: string;
  active: boolean;
}

export interface AppNotification {
  id: string;
  user_id: string;
  ticket_number?: string;
  service_id: string;
  service_name: string;
  title: string;
  message: string;
  type: 
    | 'joined' 
    | 'position_update' 
    | 'return_soon' 
    | 'turn_ready' 
    | 'grace_period' 
    | 'completed' 
    | 'delay_alert' 
    | 'service_status'
    | 'appointment';
  read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_name: string;
  actor_role: 'student' | 'staff' | 'admin';
  action: string;
  details: string;
  service_id?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  role: 'student' | 'staff' | 'admin';
  id_code: string;
  email: string;
  assigned_service_id?: string;
  assigned_counter_number?: number;
}

// ---------------------------------------------------------------- seating

export type SeatStatus = 'available' | 'maintenance' | 'unavailable';

export interface SeatZone {
  id: string;
  service_id: string;
  name: string;
  floor: string;
  /** 'quiet' zones are study carrels; 'group' zones allow conversation. */
  kind: 'quiet' | 'group' | 'open';
}

export interface Seat {
  id: string;
  zone_id: string;
  service_id: string;
  /** Human-facing identifier, e.g. "A-014". Unique within the campus. */
  label: string;
  status: SeatStatus;
  /** e.g. power outlet, monitor, window seat. Empty when plain. */
  features: string[];
}

export type SeatReservationStatus =
  | 'held'
  | 'reserved'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'no_show';

export interface SeatReservation {
  id: string;
  seat_id: string;
  service_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  status: SeatReservationStatus;
  created_at: string;
  /** The student must check in before this time or the hold is released. */
  check_in_deadline: string;
  checked_in_at?: string;
  released_at?: string;
  /** Which writer created this row, for auditability. */
  source: 'web' | 'kiosk';
}
