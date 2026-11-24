import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import prisma from './prisma';
import { getStorefrontOrgId } from './org';
import { assertNotBlacklisted } from './userBlacklist';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    throw new Error('Missing Google OAuth environment variables');
}

passport.use(
    new GoogleStrategy(
        {
            clientID: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            callbackURL: GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value?.trim().toLowerCase();
                if (!email) {
                    return done(new Error('No email found in Google profile'));
                }

                const orgId = await getStorefrontOrgId();
                await assertNotBlacklisted(orgId, { email });

                const userByEmail = await prisma.user.findUnique({ where: { email } });

                if (userByEmail && !userByEmail.googleId) {
                    return done(new Error('Account exists. Use email/password instead.'));
                }

                let user = await prisma.user.findFirst({
                    where: { googleId: profile.id, email },
                });

                if (!user) {
                    // Guest / shop self-registration via Google is closed.
                    return done(
                        new Error(
                            "No account for this Google email. Register a company workspace at /register-company."
                        )
                    );
                }

                const orgIdAfter = await getStorefrontOrgId();
                await assertNotBlacklisted(orgIdAfter, {
                    email: user.email,
                    phone: user.phoneNumber,
                });

                return done(null, user);
            } catch (error) {
                return done(error);
            }
        }
    )
);

// Optional: passport.serializeUser / deserializeUser if using sessions
