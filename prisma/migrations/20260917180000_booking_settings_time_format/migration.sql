-- CreateEnum
CREATE TYPE "TimeClockFormat" AS ENUM ('twelve_hour', 'twenty_four_hour');

-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN "timeFormat" "TimeClockFormat" NOT NULL DEFAULT 'twelve_hour';
