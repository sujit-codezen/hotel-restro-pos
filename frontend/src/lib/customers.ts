import { api } from "@/lib/api";
import { Paginated } from "@/lib/hooks";
import { Customer } from "@/lib/types";

/** Customer.phone is unique per org, so a plain POST /customers/ fails
 * with a 400 for a returning guest — look up by exact phone first, and
 * only create if nothing matched. */
export async function findOrCreateCustomer(phone: string, name: string): Promise<Customer> {
  const { data } = await api.get<Paginated<Customer>>("/customers/", {
    params: { search: phone },
  });
  const existing = data.results.find((c) => c.phone === phone);
  if (existing) return existing;

  const { data: created } = await api.post<Customer>("/customers/", { phone, name });
  return created;
}
