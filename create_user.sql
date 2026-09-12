DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
  encrypted_pw TEXT;
BEGIN
  encrypted_pw := crypt('IN@pnh%ZRdN6&e', gen_salt('bf'));
  
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, 
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
    created_at, updated_at, is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'superadmin-onlineclass@buildstart.io',
    encrypted_pw,
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    false
  );
  
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    new_user_id::text,
    format('{"sub":"%s","email":"%s"}', new_user_id::text, 'superadmin-onlineclass@buildstart.io')::jsonb,
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO onlineclass_customization.profiles (user_id, business_name, email)
  VALUES (new_user_id, 'Online Class System', 'superadmin-onlineclass@buildstart.io')
  ON CONFLICT DO NOTHING;

  INSERT INTO onlineclass_customization.user_roles (user_id, role)
  VALUES (new_user_id, 'super_admin')
  ON CONFLICT DO NOTHING;

END
$$;
