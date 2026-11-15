


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
BEGIN
  IF p_position IS NULL OR p_position NOT IN ('GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST') THEN
    RAISE EXCEPTION 'Choose a valid player position';
  END IF;
  IF p_jersey_number IS NOT NULL AND p_jersey_number NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Jersey number must be between 1 and 99';
  END IF;
  IF p_overall_rating NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION 'Overall rating must be between 1 and 99';
  END IF;
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Player attributes must be an object';
  END IF;

  UPDATE public.team_members AS member
  SET position = p_position,
      jersey_number = p_jersey_number,
      overall_rating = p_overall_rating,
      attributes = p_attributes
  FROM public.team_registrations AS registration
  WHERE member.id = p_member_id
    AND registration.id = member.registration_id
    AND registration.captain_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player is not part of your assigned roster';
  END IF;
END;
$$;


ALTER FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb", "p_email" "text", "p_image_url" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE team_members
    SET position = p_position,
        jersey_number = p_jersey_number,
        overall_rating = p_overall_rating,
        attributes = p_attributes,
        email = p_email,
        image_url = p_image_url
    WHERE id = p_member_id;
END;
$$;


ALTER FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb", "p_email" "text", "p_image_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_college_domain"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Check if the email ends with the exact IIIT Kottayam domain
  IF new.email NOT LIKE '%@iiitkottayam.ac.in' THEN
    RAISE EXCEPTION 'Access denied: You must use a valid IIIT Kottayam student email address.';
  END IF;
  
  -- If it passes, allow the user to be created!
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."enforce_college_domain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_team_logo_and_color"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Check the role of the user creating/editing the team
  SELECT role INTO user_role 
  FROM user_roles 
  WHERE user_id = auth.uid();

  -- If they are a captain, block the save if logo or color is missing!
  IF user_role = 'captain' THEN
    IF NEW.logo_url IS NULL OR NEW.color IS NULL THEN
      RAISE EXCEPTION 'Captains are required to provide both a team logo and a color.';
    END IF;
  END IF;

  -- Dictators and admins bypass this check automatically!
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_team_logo_and_color"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, real_name)
  VALUES (
    new.id,
    new.email,
    -- This specifically targets the JSON payload Google sends to Supabase!
    new.raw_user_meta_data->>'full_name' 
  );
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'default')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Set the updated_at column to the exact current timestamp
  NEW.updated_at = now();
  -- Return the newly updated row to be saved
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_vote"("selected_option_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.poll_options
  SET vote_count = vote_count + 1
  WHERE id = selected_option_id;
END;
$$;


ALTER FUNCTION "public"."increment_vote"("selected_option_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_role_manager"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('dictator', 'admin')
  );
$$;


ALTER FUNCTION "public"."is_role_manager"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_id" "uuid",
    "player_id" "uuid",
    "team_id" "uuid",
    "scored_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "minute" "text",
    "assist_id" "uuid",
    "is_own_goal" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "home_team_id" "uuid",
    "away_team_id" "uuid",
    "home_score" integer DEFAULT 0,
    "away_score" integer DEFAULT 0,
    "status" character varying(20) DEFAULT 'completed'::character varying,
    "date" timestamp with time zone,
    "venue" character varying(100),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "scorers" "jsonb" DEFAULT '[]'::"jsonb",
    "assists" "jsonb" DEFAULT '[]'::"jsonb",
    "division" character varying DEFAULT 'mens'::character varying,
    "own_goals" "jsonb" DEFAULT '[]'::"jsonb",
    "minute" "text" DEFAULT '0'''::"text",
    "is_graded" boolean DEFAULT false,
    "home_penalties" integer,
    "away_penalties" integer,
    "timer_start_time" timestamp with time zone,
    "timer_calibration" integer DEFAULT 0,
    CONSTRAINT "check_positive_scores" CHECK ((("home_score" >= 0) AND ("away_score" >= 0))),
    CONSTRAINT "matches_division_check" CHECK ((("division")::"text" = ANY ((ARRAY['mens'::character varying, 'womens'::character varying, 'freshers'::character varying, 'inter'::character varying])::"text"[])))
);


ALTER TABLE "public"."matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "logo_url" "text",
    "division" character varying DEFAULT 'mens'::character varying,
    "short_name" "text",
    "team_color" "text",
    CONSTRAINT "teams_division_check" CHECK ((("division")::"text" = ANY ((ARRAY['mens'::character varying, 'womens'::character varying, 'freshers'::character varying])::"text"[])))
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."league_schedule" WITH ("security_invoker"='true') AS
 SELECT "m"."id" AS "matchId",
    "m"."date",
    "ht"."name" AS "homeTeam",
    "at"."name" AS "awayTeam",
    "m"."venue",
    "m"."status"
   FROM (("public"."matches" "m"
     JOIN "public"."teams" "ht" ON (("m"."home_team_id" = "ht"."id")))
     JOIN "public"."teams" "at" ON (("m"."away_team_id" = "at"."id")))
  WHERE (("m"."status")::"text" = 'scheduled'::"text");


ALTER VIEW "public"."league_schedule" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."league_standings" AS
 WITH "team_stats" AS (
         SELECT "t"."id" AS "teamId",
            "t"."name" AS "teamName",
            "t"."logo_url" AS "logoUrl",
            "t"."division",
            "count"("m"."id") AS "matchesPlayed",
            "sum"(
                CASE
                    WHEN ((("m"."home_team_id" = "t"."id") AND ("m"."home_score" > "m"."away_score")) OR (("m"."away_team_id" = "t"."id") AND ("m"."away_score" > "m"."home_score"))) THEN 1
                    ELSE 0
                END) AS "won",
            "sum"(
                CASE
                    WHEN ("m"."home_score" = "m"."away_score") THEN 1
                    ELSE 0
                END) AS "drawn",
            "sum"(
                CASE
                    WHEN ((("m"."home_team_id" = "t"."id") AND ("m"."home_score" < "m"."away_score")) OR (("m"."away_team_id" = "t"."id") AND ("m"."away_score" < "m"."home_score"))) THEN 1
                    ELSE 0
                END) AS "lost",
            "sum"(
                CASE
                    WHEN ("m"."home_team_id" = "t"."id") THEN "m"."home_score"
                    ELSE "m"."away_score"
                END) AS "goalsFor",
            "sum"(
                CASE
                    WHEN ("m"."home_team_id" = "t"."id") THEN "m"."away_score"
                    ELSE "m"."home_score"
                END) AS "goalsAgainst"
           FROM ("public"."teams" "t"
             LEFT JOIN "public"."matches" "m" ON (((("t"."id" = "m"."home_team_id") OR ("t"."id" = "m"."away_team_id")) AND (("m"."status")::"text" = 'completed'::"text"))))
          GROUP BY "t"."id", "t"."name", "t"."logo_url", "t"."division"
        ), "calculated" AS (
         SELECT "team_stats"."teamId",
            "team_stats"."teamName",
            "team_stats"."logoUrl",
            "team_stats"."division",
            "team_stats"."matchesPlayed",
            "team_stats"."won",
            "team_stats"."drawn",
            "team_stats"."lost",
            "team_stats"."goalsFor",
            "team_stats"."goalsAgainst",
            ("team_stats"."goalsFor" - "team_stats"."goalsAgainst") AS "goalDifference",
            (("team_stats"."won" * 3) + "team_stats"."drawn") AS "points"
           FROM "team_stats"
        )
 SELECT "rank"() OVER (PARTITION BY "division" ORDER BY "points" DESC, "goalDifference" DESC, "goalsFor" DESC) AS "rank",
    "teamId",
    "teamName",
    "logoUrl",
    "division",
    "jsonb_build_object"('matchesPlayed', COALESCE("matchesPlayed", (0)::bigint), 'won', COALESCE("won", (0)::bigint), 'drawn', COALESCE("drawn", (0)::bigint), 'lost', COALESCE("lost", (0)::bigint), 'goalsFor', COALESCE("goalsFor", (0)::bigint), 'goalsAgainst', COALESCE("goalsAgainst", (0)::bigint), 'goalDifference', COALESCE("goalDifference", (0)::bigint), 'points', COALESCE("points", (0)::bigint)) AS "stats",
    '["W", "W", "D", "L", "W"]'::"jsonb" AS "form"
   FROM "calculated";


ALTER VIEW "public"."league_standings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" character varying(255) NOT NULL,
    "summary" "text" NOT NULL,
    "date" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "author" character varying(100),
    "image_url" "text",
    "content" "jsonb" DEFAULT '[]'::"jsonb",
    "category" "text" DEFAULT 'Official Editorial'::"text"
);


ALTER TABLE "public"."newsletter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid",
    "first_name" character varying(100) NOT NULL,
    "last_name" character varying(100) NOT NULL,
    "position" character varying(50),
    "jersey_number" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assists" integer DEFAULT 0,
    "image_url" "text",
    "overall_rating" integer DEFAULT 0,
    "attributes" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."poll_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "poll_id" "uuid",
    "option_text" "text" NOT NULL,
    "vote_count" integer DEFAULT 0
);


ALTER TABLE "public"."poll_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."polls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_text" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "division" character varying DEFAULT 'mens'::character varying,
    CONSTRAINT "polls_division_check" CHECK ((("division")::"text" = ANY ((ARRAY['mens'::character varying, 'womens'::character varying, 'both'::character varying])::"text"[])))
);


ALTER TABLE "public"."polls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."predictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "match_id" "uuid" NOT NULL,
    "predicted_home_score" integer NOT NULL,
    "predicted_away_score" integer NOT NULL,
    "predicted_scorers" "jsonb" DEFAULT '[]'::"jsonb",
    "predicted_assists" "jsonb" DEFAULT '[]'::"jsonb",
    "points_awarded" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text"
);


ALTER TABLE "public"."predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "position" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "jersey_number" integer,
    "image_url" "text",
    "overall_rating" integer DEFAULT 50,
    "attributes" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "team_members_name_check" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 80))),
    CONSTRAINT "team_members_overall_rating_check" CHECK ((("overall_rating" >= 1) AND ("overall_rating" <= 99)))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "captain_id" "uuid" NOT NULL,
    "team_name" "text" NOT NULL,
    "division" "text" DEFAULT 'mens'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "team_id" "uuid",
    CONSTRAINT "team_registrations_division_check" CHECK (("division" = ANY (ARRAY['mens'::"text", 'womens'::"text", 'freshers'::"text"]))),
    CONSTRAINT "team_registrations_team_name_check" CHECK ((("char_length"("team_name") >= 2) AND ("char_length"("team_name") <= 60)))
);


ALTER TABLE "public"."team_registrations" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."top_scorers" AS
 SELECT "p"."id",
    ((("p"."first_name")::"text" || ' '::"text") || ("p"."last_name")::"text") AS "name",
    "t"."name" AS "club",
    "t"."division",
    ( SELECT "count"("goals"."id") AS "count"
           FROM "public"."goals"
          WHERE (("goals"."player_id" = "p"."id") AND ("goals"."is_own_goal" = false))) AS "goalsScored",
    ( SELECT "count"("goals"."id") AS "count"
           FROM "public"."goals"
          WHERE ("goals"."assist_id" = "p"."id")) AS "assists"
   FROM ("public"."players" "p"
     JOIN "public"."teams" "t" ON (("p"."team_id" = "t"."id")));


ALTER VIEW "public"."top_scorers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "real_name" "text",
    "nickname" "text",
    "team_flair_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "points" integer DEFAULT 0,
    "mens_team_flair" "text",
    "womens_team_flair" "text",
    "wc_team_flair" "text"
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['default'::"text", 'editor'::"text", 'captain'::"text", 'dictator'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_award_predictions" (
    "user_id" "uuid" NOT NULL,
    "golden_boot_id" bigint,
    "golden_ball_id" bigint,
    "golden_glove_id" bigint,
    "points_awarded" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wc_award_predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_group_predictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "group_name" character varying NOT NULL,
    "predicted_1st_place" bigint NOT NULL,
    "predicted_2nd_place" bigint NOT NULL,
    "predicted_3rd_place" bigint NOT NULL,
    "predicted_4th_place" bigint NOT NULL,
    "points_awarded" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wc_group_predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_knockout_predictions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "advancing_third_place" "text"[] NOT NULL,
    "round_of_16" integer[] NOT NULL,
    "quarter_finals" integer[] NOT NULL,
    "semi_finals" integer[] NOT NULL,
    "final" integer[] NOT NULL,
    "champion_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "r16_points_awarded" integer DEFAULT 0,
    "qf_points_awarded" integer DEFAULT 0,
    "sf_points_awarded" integer DEFAULT 0,
    "final_points_awarded" integer DEFAULT 0,
    "champion_points_awarded" integer DEFAULT 0
);


ALTER TABLE "public"."wc_knockout_predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_leaderboard" (
    "user_id" "uuid" NOT NULL,
    "points" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wc_leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_matches" (
    "id" bigint NOT NULL,
    "home_team_id" bigint,
    "away_team_id" bigint,
    "home_score" integer DEFAULT 0,
    "away_score" integer DEFAULT 0,
    "status" character varying DEFAULT 'Not Started'::character varying,
    "date" timestamp with time zone,
    "stage" character varying,
    "scorers" "jsonb" DEFAULT '[]'::"jsonb",
    "assists" "jsonb" DEFAULT '[]'::"jsonb",
    "is_graded" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wc_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_players" (
    "id" bigint NOT NULL,
    "team_id" integer,
    "name" character varying NOT NULL,
    "position" character varying
);


ALTER TABLE "public"."wc_players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_predictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "match_id" bigint NOT NULL,
    "predicted_home_score" integer NOT NULL,
    "predicted_away_score" integer NOT NULL,
    "predicted_scorers" "jsonb" DEFAULT '[]'::"jsonb",
    "predicted_assists" "jsonb" DEFAULT '[]'::"jsonb",
    "points_awarded" integer DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wc_predictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wc_teams" (
    "id" bigint NOT NULL,
    "name" character varying NOT NULL,
    "logo_url" "text",
    "group_name" character varying,
    "abbreviation" "text"
);


ALTER TABLE "public"."wc_teams" OWNER TO "postgres";


ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter"
    ADD CONSTRAINT "newsletter_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."poll_options"
    ADD CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."polls"
    ADD CONSTRAINT "polls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_registrations"
    ADD CONSTRAINT "team_registrations_captain_id_key" UNIQUE ("captain_id");



ALTER TABLE ONLY "public"."team_registrations"
    ADD CONSTRAINT "team_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "unique_team_jersey" UNIQUE ("team_id", "jersey_number");



ALTER TABLE ONLY "public"."wc_group_predictions"
    ADD CONSTRAINT "unique_user_group" UNIQUE ("user_id", "group_name");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "unique_user_match_prediction" UNIQUE ("user_id", "match_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."wc_award_predictions"
    ADD CONSTRAINT "wc_award_predictions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."wc_group_predictions"
    ADD CONSTRAINT "wc_group_predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wc_knockout_predictions"
    ADD CONSTRAINT "wc_knockout_predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wc_knockout_predictions"
    ADD CONSTRAINT "wc_knockout_predictions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."wc_leaderboard"
    ADD CONSTRAINT "wc_leaderboard_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."wc_matches"
    ADD CONSTRAINT "wc_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wc_players"
    ADD CONSTRAINT "wc_players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wc_predictions"
    ADD CONSTRAINT "wc_predictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wc_teams"
    ADD CONSTRAINT "wc_teams_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_matches_date" ON "public"."matches" USING "btree" ("date");



CREATE INDEX "idx_matches_status" ON "public"."matches" USING "btree" ("status");



CREATE INDEX "idx_newsletter_date" ON "public"."newsletter" USING "btree" ("date");



CREATE INDEX "idx_players_team_id" ON "public"."players" USING "btree" ("team_id");



CREATE INDEX "idx_wc_knockouts_user" ON "public"."wc_knockout_predictions" USING "btree" ("user_id");



CREATE INDEX "team_registrations_team_id_idx" ON "public"."team_registrations" USING "btree" ("team_id");



CREATE OR REPLACE TRIGGER "check_captain_team_creation" BEFORE INSERT OR UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_team_logo_and_color"();



CREATE OR REPLACE TRIGGER "set_matches_updated_at" BEFORE UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_players_updated_at" BEFORE UPDATE ON "public"."players" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."wc_award_predictions"
    ADD CONSTRAINT "fk_golden_ball" FOREIGN KEY ("golden_ball_id") REFERENCES "public"."wc_players"("id");



ALTER TABLE ONLY "public"."wc_award_predictions"
    ADD CONSTRAINT "fk_golden_boot" FOREIGN KEY ("golden_boot_id") REFERENCES "public"."wc_players"("id");



ALTER TABLE ONLY "public"."wc_award_predictions"
    ADD CONSTRAINT "fk_golden_glove" FOREIGN KEY ("golden_glove_id") REFERENCES "public"."wc_players"("id");



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "fk_predictions_user_profiles" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_assist_id_fkey" FOREIGN KEY ("assist_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."poll_options"
    ADD CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."predictions"
    ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "public"."team_registrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_registrations"
    ADD CONSTRAINT "team_registrations_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_registrations"
    ADD CONSTRAINT "team_registrations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wc_award_predictions"
    ADD CONSTRAINT "wc_award_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."wc_group_predictions"
    ADD CONSTRAINT "wc_group_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."wc_knockout_predictions"
    ADD CONSTRAINT "wc_knockout_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wc_leaderboard"
    ADD CONSTRAINT "wc_leaderboard_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."wc_matches"
    ADD CONSTRAINT "wc_matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."wc_teams"("id");



ALTER TABLE ONLY "public"."wc_matches"
    ADD CONSTRAINT "wc_matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."wc_teams"("id");



ALTER TABLE ONLY "public"."wc_players"
    ADD CONSTRAINT "wc_players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."wc_teams"("id");



ALTER TABLE ONLY "public"."wc_predictions"
    ADD CONSTRAINT "wc_predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."wc_matches"("id");



ALTER TABLE ONLY "public"."wc_predictions"
    ADD CONSTRAINT "wc_predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Admin all access matches" ON "public"."matches" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'dictator'::"text"])));



CREATE POLICY "Admin all access newsletter" ON "public"."newsletter" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'dictator'::"text"])));



CREATE POLICY "Admin all access polls" ON "public"."polls" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'dictator'::"text"])));



CREATE POLICY "Admin all access predictions" ON "public"."predictions" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'dictator'::"text"])));



CREATE POLICY "Admin and Captain all access players" ON "public"."players" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'dictator'::"text", 'captain'::"text"])));



CREATE POLICY "Allow authenticated deletes on goals" ON "public"."goals" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated deletes on matches" ON "public"."matches" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated deletes on newsletter" ON "public"."newsletter" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated deletes on players" ON "public"."players" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated deletes on teams" ON "public"."teams" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated inserts on goals" ON "public"."goals" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated inserts on matches" ON "public"."matches" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated inserts on newsletter" ON "public"."newsletter" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated inserts on players" ON "public"."players" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated inserts on teams" ON "public"."teams" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated updates on goals" ON "public"."goals" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated updates on matches" ON "public"."matches" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated updates on newsletter" ON "public"."newsletter" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated updates on players" ON "public"."players" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated updates on teams" ON "public"."teams" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow public read access for goals" ON "public"."goals" FOR SELECT USING (true);



CREATE POLICY "Allow public read access for poll_options" ON "public"."poll_options" FOR SELECT USING (true);



CREATE POLICY "Allow public read access for polls" ON "public"."polls" FOR SELECT USING (true);



CREATE POLICY "Allow public read access for teams" ON "public"."teams" FOR SELECT USING (true);



CREATE POLICY "Allow public read for realtime matches" ON "public"."matches" FOR SELECT USING (true);



CREATE POLICY "Alow public access to read wc teams" ON "public"."wc_teams" FOR SELECT USING (true);



CREATE POLICY "Anyone can view knockout predictions" ON "public"."wc_knockout_predictions" FOR SELECT USING (true);



CREATE POLICY "Captains read their assigned players" ON "public"."team_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_registrations" "registration"
  WHERE (("registration"."id" = "team_members"."registration_id") AND ("registration"."captain_id" = "auth"."uid"())))));



CREATE POLICY "Captains read their assigned team" ON "public"."team_registrations" FOR SELECT USING (("auth"."uid"() = "captain_id"));



CREATE POLICY "Dictators manage all team members" ON "public"."team_members" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['dictator'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['dictator'::"text", 'admin'::"text"]))))));



CREATE POLICY "Dictators manage all team registrations" ON "public"."team_registrations" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['dictator'::"text", 'admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['dictator'::"text", 'admin'::"text"]))))));



CREATE POLICY "Dictators manage roles" ON "public"."user_roles" USING ("public"."is_role_manager"()) WITH CHECK ((("role" = ANY (ARRAY['default'::"text", 'captain'::"text", 'editor'::"text", 'dictator'::"text", 'admin'::"text"])) AND "public"."is_role_manager"()));



CREATE POLICY "Public profiles are viewable by everyone." ON "public"."user_profiles" FOR SELECT USING (true);



CREATE POLICY "Public read matches" ON "public"."matches" FOR SELECT USING (true);



CREATE POLICY "Public read newsletter" ON "public"."newsletter" FOR SELECT USING (true);



CREATE POLICY "Public read players" ON "public"."players" FOR SELECT USING (true);



CREATE POLICY "Users can insert their own predictions" ON "public"."predictions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own predictions" ON "public"."wc_knockout_predictions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."user_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can read their own role" ON "public"."user_roles" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_role_manager"()));



CREATE POLICY "Users can update own profile." ON "public"."user_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own predictions" ON "public"."predictions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own predictions" ON "public"."wc_knockout_predictions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own predictions" ON "public"."predictions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."newsletter" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."poll_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."polls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."predictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_award_predictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_group_predictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_knockout_predictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_leaderboard" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_predictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wc_teams" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."matches";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb", "p_email" "text", "p_image_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb", "p_email" "text", "p_image_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."captain_update_team_member"("p_member_id" "uuid", "p_position" "text", "p_jersey_number" integer, "p_overall_rating" integer, "p_attributes" "jsonb", "p_email" "text", "p_image_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_college_domain"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_college_domain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_college_domain"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_team_logo_and_color"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_team_logo_and_color"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_team_logo_and_color"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_vote"("selected_option_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_vote"("selected_option_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_vote"("selected_option_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_role_manager"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_role_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_role_manager"() TO "service_role";


















GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."league_schedule" TO "anon";
GRANT ALL ON TABLE "public"."league_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."league_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."league_standings" TO "anon";
GRANT ALL ON TABLE "public"."league_standings" TO "authenticated";
GRANT ALL ON TABLE "public"."league_standings" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter" TO "anon";
GRANT ALL ON TABLE "public"."newsletter" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter" TO "service_role";



GRANT ALL ON TABLE "public"."players" TO "anon";
GRANT ALL ON TABLE "public"."players" TO "authenticated";
GRANT ALL ON TABLE "public"."players" TO "service_role";



GRANT ALL ON TABLE "public"."poll_options" TO "anon";
GRANT ALL ON TABLE "public"."poll_options" TO "authenticated";
GRANT ALL ON TABLE "public"."poll_options" TO "service_role";



GRANT ALL ON TABLE "public"."polls" TO "anon";
GRANT ALL ON TABLE "public"."polls" TO "authenticated";
GRANT ALL ON TABLE "public"."polls" TO "service_role";



GRANT ALL ON TABLE "public"."predictions" TO "anon";
GRANT ALL ON TABLE "public"."predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."predictions" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."team_registrations" TO "anon";
GRANT ALL ON TABLE "public"."team_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."team_registrations" TO "service_role";



GRANT ALL ON TABLE "public"."top_scorers" TO "anon";
GRANT ALL ON TABLE "public"."top_scorers" TO "authenticated";
GRANT ALL ON TABLE "public"."top_scorers" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."wc_award_predictions" TO "anon";
GRANT ALL ON TABLE "public"."wc_award_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_award_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."wc_group_predictions" TO "anon";
GRANT ALL ON TABLE "public"."wc_group_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_group_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."wc_knockout_predictions" TO "anon";
GRANT ALL ON TABLE "public"."wc_knockout_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_knockout_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."wc_leaderboard" TO "anon";
GRANT ALL ON TABLE "public"."wc_leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_leaderboard" TO "service_role";



GRANT ALL ON TABLE "public"."wc_matches" TO "anon";
GRANT ALL ON TABLE "public"."wc_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_matches" TO "service_role";



GRANT ALL ON TABLE "public"."wc_players" TO "anon";
GRANT ALL ON TABLE "public"."wc_players" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_players" TO "service_role";



GRANT ALL ON TABLE "public"."wc_predictions" TO "anon";
GRANT ALL ON TABLE "public"."wc_predictions" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_predictions" TO "service_role";



GRANT ALL ON TABLE "public"."wc_teams" TO "anon";
GRANT ALL ON TABLE "public"."wc_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."wc_teams" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































