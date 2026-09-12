import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { planLabel } from "@/lib/planLabels";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Settings, Loader2, Save } from "lucide-react";

interface PlanLimit {
  max_products: number;
  max_faqs: number;
  max_orders_per_month: number;
  contacts_per_month: number;
  ai_messages_per_month: number;
  max_images_per_product: number;
}

interface PlanLimits {
  free: PlanLimit;
  pro: PlanLimit;
  enterprise: PlanLimit;
}

const defaultLimits: PlanLimits = {
  free: { max_products: 5, max_faqs: 10, max_orders_per_month: 50, contacts_per_month: 50, ai_messages_per_month: 100, max_images_per_product: 1 },
  pro: { max_products: 10, max_faqs: 40, max_orders_per_month: 200, contacts_per_month: 500, ai_messages_per_month: 2000, max_images_per_product: 10 },
  enterprise: { max_products: 20, max_faqs: 70, max_orders_per_month: 1000, contacts_per_month: 2000, ai_messages_per_month: 99999, max_images_per_product: 50 },
};

export default function AdminSettings() {
  const navigate = useNavigate();
  const { isSuperAdmin, roleLoading } = useRole();
  const { toast } = useToast();
  const [limits, setLimits] = useState<PlanLimits>(defaultLimits);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!roleLoading && !isSuperAdmin) navigate("/dashboard");
  }, [isSuperAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("platform_settings" as any)
        .select("value")
        .eq("key", "plan_limits")
        .single() as { data: { value: PlanLimits } | null; error: any };
      if (data?.value) {
        setLimits(data.value);
      }
      setLoading(false);
    };
    fetch();
  }, [isSuperAdmin]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("platform_settings" as any)
      .update({ value: limits as any })
      .eq("key", "plan_limits");

    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Plan limits saved successfully" });
    }
    setSaving(false);
  };

  const updateLimit = (tier: keyof PlanLimits, field: keyof PlanLimit, value: number) => {
    setLimits((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: value },
    }));
  };

  if (roleLoading || loading) {
    return <DashboardLayout><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
  }
  if (!isSuperAdmin) return null;

  const tiers: { key: keyof PlanLimits; label: string; color: string }[] = [
    { key: "free", label: "Free Plan", color: "border-muted" },
    { key: "pro", label: "Starter Plan", color: "border-primary/30" },
    { key: "enterprise", label: "Growth Plan", color: "border-primary" },
  ];

  const fields: { key: keyof PlanLimit; label: string }[] = [
    { key: "max_products", label: "Max Products" },
    { key: "max_faqs", label: "Max FAQs" },
    { key: "max_orders_per_month", label: "Max Orders / Month" },
    { key: "contacts_per_month", label: "Contacts / Month" },
    { key: "max_images_per_product", label: "Max Images / Product" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Settings className="h-8 w-8 text-primary" />
              Platform Settings
            </h1>
            <p className="text-muted-foreground">Configure rate limits and quotas for each plan tier</p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {tiers.map((tier) => (
            <Card key={tier.key} className={tier.color}>
              <CardHeader>
                <CardTitle>{tier.label}</CardTitle>
                <CardDescription>Set limits for {planLabel(tier.key)} tier accounts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    <Input
                      type="number"
                      value={limits[tier.key][field.key]}
                      onChange={(e) => updateLimit(tier.key, field.key, parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
