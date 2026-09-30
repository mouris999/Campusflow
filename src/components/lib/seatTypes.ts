/** Client-side shape of the seat reservation view returned by the API. */
export interface SeatReservationView {
  reservation_id: string;
  seat_label: string | null;
  zone_name: string | null;
  floor: string | null;
  service_name: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  check_in_required: boolean;
  check_in_deadline: string;
  check_in_mins_remaining: number | null;
  actionable: boolean;
}
