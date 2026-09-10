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

  try {
    const authHeader = req.headers.get("authorization") || "";
    const expectedSecret = Deno.env.get("LMS_WEBHOOK_SECRET");
    
    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const { message, numbers } = await req.json();

    if (!message || !Array.isArray(numbers) || numbers.length === 0) {
       return new Response(JSON.stringify({ error: "Invalid payload. Expected 'message' and array of 'numbers'." }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const records = numbers.map((num: string) => ({
        message_text: message,
        recipient_number: num,
        status: "pending"
    }));

    const { error } = await supabase
        .from("lms_notification_queue")
        .insert(records);

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, queued: records.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
