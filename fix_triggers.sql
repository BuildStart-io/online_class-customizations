DROP TRIGGER IF EXISTS on_auth_user_created_onlineclass ON auth.users;
CREATE TRIGGER on_auth_user_created_onlineclass
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION onlineclass_customization.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_role_onlineclass ON auth.users;
CREATE TRIGGER on_auth_user_created_role_onlineclass
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION onlineclass_customization.handle_new_user_role();

DROP TRIGGER IF EXISTS on_auth_user_created_settings_onlineclass ON auth.users;
CREATE TRIGGER on_auth_user_created_settings_onlineclass
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION onlineclass_customization.handle_new_user_settings();

DROP FUNCTION IF EXISTS onlineclass_customization.handle_new_user_wrapper();
DROP FUNCTION IF EXISTS onlineclass_customization.handle_new_user_role_wrapper();
DROP FUNCTION IF EXISTS onlineclass_customization.handle_new_user_settings_wrapper();
