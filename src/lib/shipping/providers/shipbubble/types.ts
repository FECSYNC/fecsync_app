/** Shipbubble API request/response shapes — Phase 2 rates + Phase 3 booking. */

export type ShipbubbleValidateAddressRequest = {
  name: string;
  email: string;
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;
};

export type ShipbubbleValidatedAddress = {
  name?: string;
  email?: string;
  phone?: string;
  formatted_address?: string;
  country?: string;
  country_code?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  address_code: number;
};

export type ShipbubbleValidateAddressResponse = {
  status?: string;
  message?: string;
  data?: ShipbubbleValidatedAddress;
  errors?: string[];
};

export type ShipbubblePackageItem = {
  name: string;
  description: string;
  unit_weight: string;
  unit_amount: string;
  quantity: string;
};

export type ShipbubblePackageDimension = {
  length: number;
  width: number;
  height: number;
};

export type ShipbubbleFetchRatesRequest = {
  sender_address_code: number;
  /** Shipbubble API spelling */
  reciever_address_code: number;
  pickup_date: string;
  category_id: number;
  package_items: ShipbubblePackageItem[];
  package_dimension: ShipbubblePackageDimension;
  service_type?: string;
  delivery_instructions?: string;
};

export type ShipbubbleCourierRate = {
  courier_id: string;
  courier_name: string;
  courier_image?: string;
  service_code: string;
  service_type?: string;
  delivery_eta?: string;
  currency?: string;
  vat?: number;
  total: number;
  rate_token?: string;
};

export type ShipbubbleFetchRatesResponse = {
  status?: string;
  message?: string;
  data?: {
    request_token?: string;
    couriers?: ShipbubbleCourierRate[];
    cheapest_courier?: ShipbubbleCourierRate;
  };
  errors?: string[];
};

export type ShipbubbleBookRequest = {
  request_token: string;
  service_code: string;
  courier_id: string;
  rate_token?: string;
  insurance_code?: string;
  is_cod_label?: boolean;
};

export type ShipbubbleBookResponse = {
  status?: string;
  message?: string;
  data?: {
    order_id?: string;
    tracking_number?: string;
    tracking_url?: string;
    label_url?: string;
    status?: string;
    courier?: {
      name?: string;
      email?: string;
      phone?: string;
    };
  };
};

export type ShipbubbleWebhookPayload = {
  event?: string;
  event_id?: string;
  order_id?: string;
  status?: string;
  tracking_url?: string;
  waybill_document?: string | null;
  date?: string;
  courier?: {
    name?: string;
    tracking_code?: string;
    tracking_message?: string;
  };
  package_status?: Array<{ status?: string; datetime?: string }>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};
