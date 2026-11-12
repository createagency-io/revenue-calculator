# Setup guide: passwords and the shared database

Follow these steps once. It takes about 20 minutes. When you're done:

- **Merlin, Tyson and Jonathan** each sign in with their own email and password.
- All data is saved in **one online database** (Supabase). It shows up on every phone and computer, not just one browser.
- Nobody else can see or change anything. People can't sign themselves up: only you can add someone.

You will need:
- the **netlify-upload** folder
- the **supabase/schema.sql** file (it's inside the source zip)

---

## Part 1: Create the database (Supabase, free)

1. Go to **https://supabase.com** and click **Start your project**. Sign up with GitHub or with your createagency.io email.
2. Click **New project** and fill in:
   - **Organization:** your account. You can rename it to *C.R.E.A.T.E. Agency*.
   - **Project name:** `create-finance`
   - **Database password:** click **Generate a password** and save it in your password manager. You won't need it day to day.
   - **Region:** pick the one closest to Nigeria, for example **West Europe (London)** or **Central Europe (Frankfurt)**.
   - Click **Create new project** and wait about 2 minutes.
3. Set up the tables and security rules:
   - In the left menu, click **SQL Editor**, then **New query**.
   - Open `supabase/schema.sql` in Notepad, copy **everything**, paste it into the editor, and click **Run**.
   - You should see "Success. No rows returned".

## Part 2: Turn off public sign-ups

1. In the left menu, go to **Authentication** and open **Sign In / Providers**. On some versions this is under **Settings**.
2. Turn **OFF** the option "**Allow new users to sign up**", then click **Save**.
3. Make sure **Email** is enabled as a sign-in method. It is on by default.
4. Optional but recommended: in the password settings, set the **minimum password length to 10**.

## Part 3: Create the three logins

1. Go to **Authentication → Users**, click **Add user**, then **Create new user**.
2. Enter **your** email and a strong password. Tick **Auto Confirm User** and click **Create user**.
3. Repeat for **Tyson** and **Jonathan** with their emails. Give them a temporary password; each of them can change it later with "Forgot your password?".

## Part 4: Put the three of you on the team list

A login alone is not enough. The database only lets in emails that are on the team list.

1. Go to **SQL Editor** and click **New query**.
2. Paste the following, replacing the emails with the real ones (lower case):
   ```sql
   insert into public.app_members (email, display_name) values
     ('merlin@createagency.io',   'Merlin'),
     ('tyson@createagency.io',    'Tyson'),
     ('jonathan@createagency.io', 'Jonathan')
   on conflict (email) do update set display_name = excluded.display_name;
   ```
3. Click **Run**.

## Part 5: Copy your two connection values

1. Click the **gear icon (Project Settings)**, then **API**. Or click the **Connect** button at the top.
2. Copy these two values:
   - the **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - the **anon public** key, which starts with `eyJ`. If you only see a **publishable** key starting with `sb_publishable_`, that works too.

> ⚠️ **Never** copy the **service_role** or **secret** key. That key can bypass every rule, and the app will refuse it anyway.

## Part 6: Add the values to the app

1. Open the **netlify-upload** folder and right-click **config.js** → **Open with → Notepad**.
2. Paste the two values between the quotes:
   ```js
   window.CREATE_CONFIG = {
     supabaseUrl: "https://abcdefgh.supabase.co",
     supabaseAnonKey: "eyJhbGciOi....",
     idleMinutes: 30
   };
   ```
3. Save and close.

`idleMinutes` controls how long someone can be inactive before they're signed out automatically. The default is 30.

## Part 7: Put it online (Netlify)

1. Go to **https://app.netlify.com/drop** and sign in.
2. Drag the whole **netlify-upload** folder onto the page.
3. Rename the site under **Site configuration → Change site name**, for example `create-finance`. Your address becomes `https://create-finance.netlify.app`.

## Part 8: Make password-reset emails point to your site

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Netlify address, for example `https://create-finance.netlify.app`.
3. Under **Redirect URLs**, click **Add URL** and add the same address followed by `/**`, for example `https://create-finance.netlify.app/**`. Click **Save**.

## Part 9: Test it

1. Open your Netlify address. You should see the **Sign in** screen.
2. Sign in with your email and password. The app opens with no projects yet, which is expected because it's a fresh database.
3. Optional: to try things out, go to **Settings → Reset to demo data**. When you're finished, click **Clear demo projects**.
4. Ask Tyson to sign in on his phone. He should see the same projects.

Done. Share the Netlify address with Tyson and Jonathan.

---

## Everyday questions

**Someone forgot their password.**
They click **Forgot your password?** on the sign-in screen and follow the email link. Supabase's free plan sends only a few emails per hour. If the email doesn't arrive, wait a bit and check spam.

**How do I add a new person?**
Do Part 3 (create the login) and Part 4 (add their email to the team list) for them.

**How do I remove someone?**
1. In the **SQL Editor**, run `delete from public.app_members where email = 'their@email.com';`
2. Then go to **Authentication → Users** and delete their login.

They lose access straight away.

**Someone deleted or messed up a project. Can I get it back?**
Yes. Every save and every delete is kept in the history table. In the **SQL Editor**, run:
```sql
select changed_at, changed_by, action, data->>'title' as title, history_id
from public.project_history order by changed_at desc limit 50;
```
Find the row for the version you want, then run the restore command with its `history_id`, for example:
```sql
select public.restore_project(123);
```
This command only works from the Supabase dashboard, not from inside the app.

**Two of us edited the same project at once.**
The app notices and asks the second person whether to **keep their version** or **use the other person's version**. Nothing gets overwritten without anyone knowing.

**What if the internet drops?**
The sidebar shows "Offline — will retry". Your changes are kept on screen and save automatically when the connection comes back. Don't close the tab until it says "All changes saved".

**Backups.**
The database keeps everything, but it's still a good idea to click **Export JSON backup** in Settings about once a month and keep the file somewhere safe.

**Free plan limits to know about.**
- Supabase **pauses a free project after about a week with no activity**. If that happens, open the Supabase dashboard and click **Restore**.
- The free plan doesn't include downloadable daily backups. That's another reason to export a JSON backup monthly.
- If the agency grows, Supabase's paid plan removes these limits.
