export type Store = {
  id: string;
  parent_store: string | null;
  store_type: "RESTAURANT" | "HOTEL_PROPERTY";
  name: string;
  address: string;
  phone: string;
  is_active: boolean;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  business_type: "RESTAURANT" | "HOTEL" | "HOTEL_RESTAURANT";
  timezone: string;
  currency: string;
};

export type MenuCategory = { id: string; store: string; name: string; sort_order: number };

export type TaxClass = { id: string; name: string; rate_percent: string; is_inclusive: boolean };

export type Modifier = { id: string; modifier_group: string; name: string; price_delta: string };

export type ModifierGroup = {
  id: string;
  store: string;
  name: string;
  selection_type: "SINGLE" | "MULTIPLE";
  min_select: number;
  max_select: number;
  is_required: boolean;
  modifiers: Modifier[];
};

export type MenuItem = {
  id: string;
  store: string;
  category: string | null;
  name: string;
  price: string;
  tax_class: string | null;
  kitchen_station: string;
  is_active: boolean;
  image: string | null;
  modifier_groups: ModifierGroup[];
};

export type TableStatus = "AVAILABLE" | "OCCUPIED" | "BILLING" | "RESERVED";

export type PosTable = {
  id: string;
  store: string;
  name: string;
  slug: string;
  capacity: number;
  status: TableStatus;
  pos_x: number;
  pos_y: number;
  shape: string;
};

export type OrderItemModifierT = {
  id: string;
  modifier: string;
  modifier_name: string;
  modifier_group_name: string;
  price_delta: string;
};

export type OrderItem = {
  id: string;
  menu_item: string;
  menu_item_name: string;
  quantity: string;
  unit_price: string;
  notes: string;
  status: "NEW" | "COOKING" | "READY" | "SERVED" | "CANCELLED";
  kitchen_station: string;
  modifiers: OrderItemModifierT[];
  invoice: string | null;
  sent_to_kitchen: boolean;
};

export type OrderT = {
  id: string;
  store: string;
  order_type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ROOM_SERVICE";
  table: string | null;
  customer: string | null;
  guest_stay: string | null;
  status: string;
  created_at: string;
  items: OrderItem[];
};

export type KitchenTicket = {
  id: string;
  order: string;
  order_type: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ROOM_SERVICE";
  table_name: string | null;
  kitchen_station: string;
  status: "NEW" | "COOKING" | "READY" | "SERVED";
  created_at: string;
  ticket_items: { id: string; order_item: OrderItem }[];
};

export type InvoiceLineT = {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_amount: string;
  source_type: string;
};

export type RefundT = {
  id: string;
  payment: string;
  amount: string;
  reason: string;
  refunded_by: string | null;
  created_at: string;
};

export type PaymentT = {
  id: string;
  method: string;
  amount: string;
  reference_number: string;
  received_at: string;
  change_given: string | null;
  refunds: RefundT[];
  refundable_amount: number;
};

export type InvoiceT = {
  id: string;
  store: string;
  source_type: "ORDER" | "FOLIO";
  order: string | null;
  folio: string | null;
  customer: string | null;
  status: "DRAFT" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "VOID";
  subtotal: string;
  discount: string | null;
  discount_name: string | null;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  display_number: string | null;
  finalized_at: string | null;
  lines: InvoiceLineT[];
  payments: PaymentT[];
  balance_due: number;
};

export type Customer = {
  id: string;
  phone: string;
  name: string;
  email: string;
  loyalty_points: number;
  credit_balance: string;
};

export type RoomType = { id: string; store: string; name: string; base_rate: string; capacity: number };

export type RoomStatus = "AVAILABLE" | "OCCUPIED" | "DIRTY" | "MAINTENANCE";

export type Room = {
  id: string;
  store: string;
  room_type: string;
  room_type_name: string;
  number: string;
  floor: string;
  status: RoomStatus;
};

export type ReservationStatus = "BOOKED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";

export type ReservationFoodItem = {
  id: string;
  menu_item: string;
  menu_item_name: string;
  quantity: string;
  unit_price: string;
  notes: string;
};

export type Reservation = {
  id: string;
  store: string;
  guest: string;
  guest_name: string;
  guest_phone: string;
  room_type: string;
  room_type_name: string;
  room: string | null;
  room_number: string | null;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  adults: number;
  children: number;
  rate_per_night: string;
  guest_stay_id: string | null;
  food_items: ReservationFoodItem[];
};

export type GuestStay = {
  id: string;
  store: string;
  reservation: string | null;
  room: string;
  room_number: string;
  guest: string;
  guest_name: string;
  guest_phone: string;
  check_in_at: string;
  check_out_at: string | null;
  status: "IN_HOUSE" | "CHECKED_OUT";
};

export type FolioLineT = {
  id: string;
  line_type: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_amount: string;
  created_at: string;
};

export type FolioDeposit = {
  id: string;
  method: string;
  amount: string;
  reference_number: string;
  received_at: string;
};

export type Folio = {
  id: string;
  store: string;
  guest_stay: string;
  status: "OPEN" | "CLOSED";
  lines: FolioLineT[];
  deposits: FolioDeposit[];
  total: number;
  total_deposits: number;
  balance_due: number;
};

export type DashboardDayTrend = { date: string; sales: number; orders: number; items_sold: number };

export type DashboardSummary = {
  todays_sales: number;
  todays_orders: number;
  items_sold: number;
  pending_credit: number;
  last_7_days: DashboardDayTrend[];
};
