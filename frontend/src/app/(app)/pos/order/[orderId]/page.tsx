"use client";

import { useParams, useRouter } from "next/navigation";

import { PosOrderScreen } from "@/components/pos-order-screen";

/** Reached from Tables ("Start order"/"Open order") — this order's id is
 * part of the URL on purpose (bookmarkable, safe to refresh, and it's how
 * a table's own tile knows which order to link back to). The POS quick-
 * entry at /pos renders the same PosOrderScreen without putting the id in
 * its URL at all — see that page for why. */
export default function OrderScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();

  return (
    <PosOrderScreen
      orderId={orderId}
      onSwitchOrder={(newOrderId) => router.push(`/pos/order/${newOrderId}`)}
      onDone={({ hasTable }) => router.push(hasTable ? "/pos/tables" : "/pos")}
    />
  );
}
