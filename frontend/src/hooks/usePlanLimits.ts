import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PlanLimit {
  max_products: number;
  max_faqs: number;
  max_orders_per_month: number;
  contacts_per_month: number;
  ai_messages_per_month: number;
  max_images_per_product: number;
  max_staff: number;
}

export interface UsageData {
  products: number;
  faqs: number;
  orders_this_month: number;
  contacts_this_month: number;
  ai_messages_this_month: number;
}

export interface BillingInfo {
  billing_cycle_start: string | null;
  is_paused: boolean;
  next_cycle_date: string | null;
}

const defaultLimits: Record<string, PlanLimit> = {
  free: { max_products: 5, max_faqs: 10, max_orders_per_month: 50, contacts_per_month: 50, ai_messages_per_month: 100, max_images_per_product: 1, max_staff: 0 },
  pro: { max_products: 10, max_faqs: 40, max_orders_per_month: 200, contacts_per_month: 500, ai_messages_per_month: 2000, max_images_per_product: 10, max_staff: 0 },
  enterprise: { max_products: 20, max_faqs: 70, max_orders_per_month: 1000, contacts_per_month: 2000, ai_messages_per_month: 99999, max_images_per_product: 50, max_staff: 2 },
};

function getNextCycleDate(billingStart: string | null): string | null {
  if (!billingStart) return null;
  const start = new Date(billingStart);
  const now = new Date();
  const next = new Date(start);
  // Advance month by month until next is in the future
  while (next <= now) {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString();
}

function getBillingMonthStart(billingStart: string | null): string {
  if (!billingStart) {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const start = new Date(billingStart);
  const now = new Date();
  const current = new Date(start);
  while (true) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    if (next > now) break;
    current.setMonth(current.getMonth() + 1);
  }
  return current.toISOString();
}

export function usePlanLimits() {
  const { user } = useAuth();
  const [limits, setLimits] = useState<PlanLimit | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [planTier, setPlanTier] = useState<string>("free");
  const [billing, setBilling] = useState<BillingInfo>({ billing_cycle_start: null, is_paused: false, next_cycle_date: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan_tier, billing_cycle_start, is_paused, addon_products, addon_faqs, addon_orders, addon_contacts, addon_ai_messages, addon_images, addon_staff")
          .eq("user_id", user.id)
          .single();

        const tier = profile?.plan_tier || "free";
        setPlanTier(tier);

        const billingStart = profile?.billing_cycle_start || null;
        setBilling({
          billing_cycle_start: billingStart,
          is_paused: profile?.is_paused || false,
          next_cycle_date: getNextCycleDate(billingStart),
        });

        const { data: platformSettings } = await supabase
          .from("platform_settings" as any)
          .select("value")
          .eq("key", "plan_limits")
          .single() as { data: { value: any } | null; error: any };

        const allLimits = platformSettings?.value || defaultLimits;
        const tierLimits = allLimits[tier] || defaultLimits[tier];

        // Apply add-ons on top of plan limits
        const addons = {
          products: profile?.addon_products || 0,
          faqs: profile?.addon_faqs || 0,
          orders: profile?.addon_orders || 0,
          contacts: (profile as any)?.addon_contacts || 0,
          ai_messages: profile?.addon_ai_messages || 0,
          images: profile?.addon_images || 0,
          staff: (profile as any)?.addon_staff || 0,
        };

        setLimits({
          max_products: tierLimits.max_products + addons.products,
          max_faqs: tierLimits.max_faqs + addons.faqs,
          max_orders_per_month: tierLimits.max_orders_per_month + addons.orders,
          contacts_per_month: (tierLimits.contacts_per_month || 50) + addons.contacts,
          ai_messages_per_month: (tierLimits.ai_messages_per_month || tierLimits.ai_messages_per_day || 100) + addons.ai_messages,
          max_images_per_product: (tierLimits.max_images_per_product || 1) + addons.images,
          max_staff: (tierLimits.max_staff || 0) + addons.staff,
        });

        // Use billing cycle start for monthly counts
        const monthStart = getBillingMonthStart(billingStart);

        const [productsRes, faqsRes, ordersRes, aiMsgsRes, contactsRes] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase.from("faqs").select("id", { count: "exact", head: true }),
          supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
          supabase.from("ai_usage_logs" as any).select("id", { count: "exact", head: true })
            .gte("created_at", monthStart),
          supabase.rpc("get_contact_usage" as any, { _user_id: user.id, _since: monthStart } as any),
        ]);

        setUsage({
          products: productsRes.count || 0,
          faqs: faqsRes.count || 0,
          orders_this_month: ordersRes.count || 0,
          contacts_this_month: (contactsRes as any)?.data || 0,
          ai_messages_this_month: aiMsgsRes.count || 0,
        });
      } catch (error) {
        console.error("Error fetching plan limits:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const canAddProduct = usage && limits ? usage.products < limits.max_products : true;
  const canAddFaq = usage && limits ? usage.faqs < limits.max_faqs : true;
  const canAddOrder = usage && limits ? usage.orders_this_month < limits.max_orders_per_month : true;
  const canAddContact = usage && limits ? usage.contacts_this_month < limits.contacts_per_month : true;
  const canSendAiMessage = canAddContact;
  const isPaused = billing.is_paused;

  return { limits, usage, planTier, billing, loading, canAddProduct, canAddFaq, canAddOrder, canAddContact, canSendAiMessage, isPaused };
}
