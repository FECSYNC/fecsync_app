import puppeteer from "puppeteer";
import { writeFile } from "fs/promises";
import { v4 as uuid } from "uuid";
import path from "path";
import { notificationTransporter, wrapEmailHtml, sanitizeSmtpDisplayName } from "./mailer";
import {
  getPlatformBrandFallback,
  resolveBrandForOrg,
  type CompanyBrandForDocuments,
} from "@/lib/companyProfile";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const sendReceiptMail = async ({
    to,
    subject,
    data,
    orgId,
}: {
    to: string;
    subject: string;
    data: {
        customerName: string;
        receiptId: string;
        amountPaid: number;
        paymentMethod: string;
        date: string;
        /** Optional venue-booking confirmation deep links (absolute path, app-relative). */
        magicPath?: string;
        confirmationPath?: string;
        rsvpPath?: string;
        payPath?: string;
        /** Absolute waiver signing URL when the booking still needs a waiver. */
        waiverUrl?: string;
    };
    orgId?: string | null;
}) => {
    if (!process.env.NOTIFICATION_EMAIL_USER?.trim()) {
        throw new Error("NOTIFICATION_EMAIL_USER is not configured");
    }
    const brand = orgId
      ? await resolveBrandForOrg(orgId)
      : getPlatformBrandFallback();
    const html = generateReceiptHtml(data, brand);
    const pdfPath = path.join(process.cwd(), "tmp", `receipt-${uuid()}.pdf`);
    const firstName = escapeHtml(
      data.customerName ? data.customerName.trim().split(/\s+/)[0] : "Customer"
    );
    const displayName = brand.displayName || "Company";
    const { publicAppBaseUrl } = await import("@/lib/publicAppBaseUrl");
    const appBase = publicAppBaseUrl();
    const toAbs = (p?: string) =>
      p && appBase
        ? `${appBase}${p.startsWith("/") ? "" : "/"}${p}`
        : p || "";
    const confirmationHref = toAbs(data.confirmationPath);
    const magicHref = toAbs(data.magicPath);
    const rsvpHref = toAbs(data.rsvpPath);
    const payHref = toAbs(data.payPath);
    const linkParts: string[] = [];
    if (confirmationHref) {
      linkParts.push(
        `<a href="${escapeHtml(confirmationHref)}" style="color:#D4AF37;font-weight:600;">View booking confirmation</a>`
      );
    }
    if (magicHref) {
      linkParts.push(
        `<a href="${escapeHtml(magicHref)}" style="color:#D4AF37;font-weight:600;">Open magic portal</a>`
      );
    }
    if (rsvpHref) {
      linkParts.push(
        `<a href="${escapeHtml(rsvpHref)}" style="color:#D4AF37;font-weight:600;">RSVP to party</a>`
      );
    }
    if (payHref) {
      linkParts.push(
        `<a href="${escapeHtml(payHref)}" style="color:#D4AF37;font-weight:600;">Pay this booking</a>`
      );
    }
    if (data.waiverUrl) {
      linkParts.push(
        `<a href="${escapeHtml(data.waiverUrl)}" style="color:#D4AF37;font-weight:600;">Sign your waiver</a>`
      );
    }
    const bookingLinksHtml = linkParts.length
        ? `<p style="margin: 16px 0 0;">${linkParts.join(" · ")}</p>`
        : "";
    const baseHtml = wrapEmailHtml(
      `
                <h1>Payment Receipt</h1>
                <p>Hi ${firstName},</p>
                <p>Thank you for your recent payment. Your receipt details are included below.</p>
                
                <div class="success-box">
                    <p style="margin: 0;"><strong>Receipt ID:</strong> #${escapeHtml(String(data.receiptId))}</p>
                    <p style="margin: 0;"><strong>Amount Paid:</strong> ₦${Number(data.amountPaid).toLocaleString()}</p>
                    <p style="margin: 0;"><strong>Payment Method:</strong> ${escapeHtml(String(data.paymentMethod))}</p>
                </div>
                ${bookingLinksHtml}
                
                <p>If you have any questions regarding this transaction, please don't hesitate to reach out to our support team.</p>
                
                <div class="divider"></div>
                
                <p style="margin: 0; color: #6b7280; font-size: 14px;">
                    Best regards,<br>
                    <strong style="color: #1f2937;">The ${escapeHtml(displayName)} Team</strong>
                </p>
            `,
      subject,
      {
        displayName,
        logoUrl: brand.logoUrl,
        supportEmail: brand.supportEmail || brand.replyToEmail,
      }
    );

    const mailOptions: {
        from: string;
        to: string;
        subject: string;
        html: string;
        replyTo?: string;
        attachments?: { filename: string; path: string; contentType: string }[];
    } = {
        from: `"${sanitizeSmtpDisplayName(displayName)}" <${process.env.NOTIFICATION_EMAIL_USER}>`,
        to,
        subject,
        html: baseHtml,
    };
    const replyTo = (brand.replyToEmail || brand.supportEmail || "").trim();
    if (replyTo.includes("@")) {
        mailOptions.replyTo = replyTo;
    }

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
        // Try to attach a PDF receipt, but do not fail email delivery if Chromium is unavailable.
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });

        await writeFile(pdfPath, pdfBuffer);
        mailOptions.attachments = [
            {
                filename: "receipt.pdf",
                path: pdfPath,
                contentType: "application/pdf",
            },
        ];
    } catch (error) {
        console.warn("Receipt PDF generation failed; sending email without attachment:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    await notificationTransporter.sendMail(mailOptions);
};

export const generateReceiptHtml = (
  data: {
    customerName: string;
    receiptId: string;
    amountPaid: number;
    paymentMethod: string;
    date: string;
    magicPath?: string;
    confirmationPath?: string;
    rsvpPath?: string;
    payPath?: string;
  },
  brand: CompanyBrandForDocuments = getPlatformBrandFallback()
) => {
    const logoUrl = brand.logoUrl ? escapeHtml(brand.logoUrl) : "";
    const displayName = escapeHtml(brand.displayName || "Company");
    const accent = escapeHtml(brand.letterheadColor || "#D4AF37");
    const safeReceiptId = escapeHtml(String(data.receiptId || ""));
    const safeDate = escapeHtml(String(data.date || ""));
    const safeCustomer = escapeHtml(String(data.customerName || ""));
    const safeMethod = escapeHtml(String(data.paymentMethod || ""));
    const supportRaw = brand.supportEmail || brand.replyToEmail || "";
    const safeSupport = supportRaw ? escapeHtml(supportRaw) : "";
    const safeFooter = escapeHtml(
      brand.receiptFooterNote ||
        `Thank you for choosing ${brand.displayName || "us"}!`
    );

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Receipt ${safeReceiptId}</title>
        <style>
            body { 
                font-family: 'Segoe UI', Arial, sans-serif; 
                margin: 0; 
                padding: 0; 
                background-color: #ffffff;
            }
            .receipt-container {
                max-width: 800px;
                margin: 0 auto;
            }
            .header {
                background-color: #000000;
                padding: 40px 20px;
                text-align: center;
                border-bottom: 5px solid ${accent};
            }
            .header img {
                height: 70px;
                width: auto;
                margin-bottom: 20px;
            }
            .header h1 {
                color: #ffffff;
                margin: 0;
                font-size: 24px;
                text-transform: uppercase;
                letter-spacing: 4px;
                font-weight: 300;
            }
            .receipt-banner {
                background-color: #f9fafb;
                padding: 20px;
                text-align: center;
                border-bottom: 1px solid #e5e7eb;
            }
            .receipt-id {
                color: #6b7280;
                font-size: 14px;
                font-weight: 600;
            }
            .content {
                padding: 40px;
            }
            .receipt-details {
                margin: 0 0 40px 0;
            }
            .detail-row {
                display: flex;
                justify-content: space-between;
                padding: 16px 0;
                border-bottom: 1px solid #f3f4f6;
            }
            .label {
                font-weight: 600;
                color: #4b5563;
                text-transform: uppercase;
                font-size: 12px;
                letter-spacing: 1px;
            }
            .value {
                color: #111827;
                font-weight: 500;
            }
            .amount-box {
                background: linear-gradient(135deg, #000000 0%, #1a1a1a 100%);
                color: #ffffff;
                padding: 40px;
                border-radius: 16px;
                text-align: center;
                margin: 40px 0;
                position: relative;
                overflow: hidden;
            }
            .amount-box::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: ${accent};
            }
            .amount-label {
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 2px;
                color: #9ca3af;
                margin-bottom: 8px;
            }
            .amount-paid {
                font-size: 42px;
                font-weight: 700;
                color: ${accent};
            }
            .footer {
                text-align: center;
                padding: 40px;
                background-color: #f9fafb;
                color: #6b7280;
                font-size: 13px;
                border-top: 1px solid #e5e7eb;
            }
            .thank-you {
                color: #111827;
                font-weight: 700;
                font-size: 18px;
                margin-bottom: 8px;
            }
            .contact-info {
                margin-top: 16px;
            }
            .contact-info a {
                color: ${accent};
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <div class="receipt-container">
            <div class="header">
                ${logoUrl ? `<img src="${logoUrl}" alt="${displayName}">` : ""}
                <h1>Official Receipt</h1>
            </div>
            
            <div class="receipt-banner">
                <div class="receipt-id">RECEIPT NO. #${safeReceiptId}</div>
            </div>

            <div class="content">
                <div class="receipt-details">
                    <div class="detail-row">
                        <span class="label">Payment Date</span>
                        <span class="value">${safeDate}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Customer Name</span>
                        <span class="value">${safeCustomer}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Payment Method</span>
                        <span class="value">${safeMethod}</span>
                    </div>
                </div>

                <div class="amount-box">
                    <div class="amount-label">Total Amount Paid</div>
                    <div class="amount-paid">₦${Number(data.amountPaid).toLocaleString()}</div>
                </div>

                <div class="footer">
                    <div class="thank-you">${safeFooter}</div>
                    <p>Your support helps us continue empowering skilled craftsmen.</p>
                    ${
                      safeSupport
                        ? `<div class="contact-info">
                        Questions? Email us at <a href="mailto:${safeSupport}">${safeSupport}</a>
                    </div>`
                        : ""
                    }
                    <p style="margin-top: 24px;">© ${new Date().getFullYear()} ${displayName}. All rights reserved.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
};