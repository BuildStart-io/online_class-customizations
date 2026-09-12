import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { db: { schema: "onlineclass_customization" } });

  console.log(`[process-lms-notifications] Triggered by cron`);

  // 1. Fetch pending messages (limit to 15 to avoid timeouts)
  const { data: pendingMessages, error: fetchError } = await supabase
    .from("lms_notification_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(15);

  if (fetchError) {
    console.error("Queue fetch error:", fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: corsHeaders });
  }

  if (!pendingMessages || pendingMessages.length === 0) {
    console.log("[process-lms-notifications] No pending messages");
    return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
  }

  // 2. Mark them as processing
  const ids = pendingMessages.map(m => m.id);
  await supabase
    .from("lms_notification_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("id", ids);

  let processedCount = 0;

  // 3. Process each message
  for (const msg of pendingMessages) {
    try {
      // Add delay (anti-ban) 5 seconds
      if (processedCount > 0) {
          await new Promise(r => setTimeout(r, 5000));
      }

      console.log(`Sending to ${msg.recipient_number}`);

      const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-onlineclass`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
            to: msg.recipient_number, 
            message: msg.message_text,
            sessionApiKey: Deno.env.get("WAHA_DEFAULT_SESSION") || "default"
        }),
      });

      if (!res.ok) {
          throw new Error(`WAHA Failed: ${await res.text()}`);
      }

      await supabase
        .from("lms_notification_queue")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", msg.id);
        
      processedCount++;

    } catch (error) {
      console.error(`Message ${msg.id} failed:`, error);
      await supabase
        .from("lms_notification_queue")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", msg.id);
    }
  }

  return new Response(JSON.stringify({ processed: processedCount }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
