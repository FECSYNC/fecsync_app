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

export const sendInvoiceMail = async ({
  to,
  subject,
  data,
  orgId,
}: {
  to: string;
  subject: string;
  data: {
    customerName: string;
    invoiceId: string;
    items: {
      product: { name: string; price: number }, quantity: number
    }[];
    totalAmount: number;
    dueDate: string;
    date: string;
    paymentMethod: string;
    payUrl?: string | null;
  };
  orgId?: string | null;
}) => {
  if (!process.env.NOTIFICATION_EMAIL_USER?.trim()) {
    throw new Error("NOTIFICATION_EMAIL_USER is not configured");
  }
  const brand = orgId
    ? await resolveBrandForOrg(orgId)
    : getPlatformBrandFallback();
  const html = generateInvoiceHtml(data, brand);
  const pdfPath = path.join(process.cwd(), "tmp", `invoice-${uuid()}.pdf`);
  const displayName = brand.displayName || "Company";
  const firstName = escapeHtml(
    data.customerName ? data.customerName.trim().split(/\s+/)[0] : "Customer"
  );
  let payCta = "";
  const payUrlRaw = data.payUrl?.trim() || "";
  if (payUrlRaw) {
    try {
      const u = new URL(payUrlRaw);
      if (u.protocol === "http:" || u.protocol === "https:") {
        payCta = `<p style="text-align:center;margin:24px 0;"><a href="${escapeHtml(u.toString())}" class="button">Pay invoice</a></p>`;
      }
    } catch {
      payCta = "";
    }
  }
  const baseHtml = wrapEmailHtml(
    `
      <h1>Payment Invoice</h1>
      <p>Hi ${firstName},</p>
      <p>Please find your invoice details below. A PDF copy is attached when available.</p>
      <div class="success-box">
        <p style="margin: 0;"><strong>Invoice ID:</strong> #${escapeHtml(String(data.invoiceId))}</p>
        <p style="margin: 0;"><strong>Amount due:</strong> ₦${Number(data.totalAmount).toLocaleString()}</p>
        <p style="margin: 0;"><strong>Payment method:</strong> ${escapeHtml(String(data.paymentMethod))}</p>
      </div>
      ${payCta}
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
        filename: "invoice.pdf",
        path: pdfPath,
        contentType: "application/pdf",
      },
    ];
  } catch (error) {
    console.warn("Invoice PDF generation failed; sending email without attachment:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  await notificationTransporter.sendMail(mailOptions);
};

export const generateInvoiceHtml = (
  data: {
    customerName: string;
    invoiceId: string;
    items: {
      product: { name: string; price: number }, quantity: number;
    }[];
    totalAmount: number;
    dueDate: string;
    date: string;
    paymentMethod: string;
    payUrl?: string | null;
  },
  brand: CompanyBrandForDocuments = getPlatformBrandFallback()
) => {
  const { customerName, invoiceId, items, totalAmount, date, dueDate, paymentMethod } = data;
  const displayName = escapeHtml(brand.displayName || "Company");
  const accent = escapeHtml(brand.letterheadColor || "#D4AF37");
  const safeCustomer = escapeHtml(customerName || "Customer");
  const safeInvoiceId = escapeHtml(String(invoiceId || ""));
  const safeDate = escapeHtml(String(date || ""));
  const safeDue = escapeHtml(String(dueDate || ""));
  const safeMethod = escapeHtml(String(paymentMethod || ""));
  const safeLogo = brand.logoUrl
    ? escapeHtml(brand.logoUrl).replace(/"/g, "&quot;")
    : "";
  const safeTax = brand.taxId ? escapeHtml(brand.taxId) : "";
  const safeFooter = escapeHtml(
    brand.invoiceFooterNote || "Thank you for your business!"
  );
  const bankLine = [
    brand.bankName,
    brand.bankAccountName,
    brand.bankAccountLast4 ? `•••• ${brand.bankAccountLast4}` : null,
    brand.bankCurrency,
  ]
    .filter(Boolean)
    .map((p) => escapeHtml(String(p)))
    .join(" · ");
  const addressHtml = brand.addressLines.length
    ? `<p>${brand.addressLines.map((l) => escapeHtml(l)).join(", ")}</p>`
    : "";

  const itemsHtml = items
    .map(
      (item) => {
        const price = item.product?.price || 0;
        const quantity = item.quantity || 0;
        const total = quantity * price;
        const name = escapeHtml(item.product?.name || "Unknown Item");
        return `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${name}</td>
          <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${quantity}</td>
          <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">₦${price.toLocaleString()}</td>
          <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">₦${total}</td>
        </tr>
      `
      }
    )
    .join("");

  const payUrlRaw = data.payUrl?.trim() || "";
  let payBlock = "";
  if (payUrlRaw) {
    try {
      const u = new URL(payUrlRaw);
      if (u.protocol === "http:" || u.protocol === "https:") {
        payBlock = `
            <div style="text-align: center; margin: 20px 0;">
                <a href="${escapeHtml(u.toString())}" class="pay-button">Pay Now</a>
            </div>
            `;
      }
    } catch {
      payBlock = "";
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice ${safeInvoiceId}</title>
      <style>
       .receipt-id {
                color: #666;
                font-size: 14px;
                margin-top: 5px;
            }
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid ${accent}; padding-bottom: 16px; }
        .header img { height: 56px; margin-bottom: 12px; }
        .invoice-details { margin-bottom: 20px; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .table th { background-color: #f5f5f5; padding: 12px; border: 1px solid #ddd; text-align: left; }
        .table td { padding: 10px; border: 1px solid #ddd; }
        .total { text-align: right; margin-top: 20px; font-size: 18px; font-weight: bold; color: ${accent}; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; border-top: 2px solid ${accent}; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="header">
      ${safeLogo ? `<img src="${safeLogo}" alt="${displayName}" />` : ""}
      <h1>PAYMENT INVOICE</h1>
       <div class="receipt-id">Receipt #${safeInvoiceId}</div>
       
      </div>
      
      <div class="invoice-details">
        <p><strong>From:</strong> ${displayName}</p>
        ${addressHtml}
        ${safeTax ? `<p><strong>Tax ID:</strong> ${safeTax}</p>` : ""}
        ${bankLine ? `<p><strong>Bank:</strong> ${bankLine}</p>` : ""}
        <p><strong>Date:</strong> ${safeDate}</p>
        <p><strong>Due Date:</strong> ${safeDue}</p>
        <p><strong>Billed To:</strong> ${safeCustomer}</p>
        <p><strong>Payment Method:</strong> ${safeMethod} </p>
      </div>
${payBlock}
      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align: center;">Quantity</th>
            <th style="text-align: right;">Unit Price</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="total">
        <p>Total Amount: ₦${Number(totalAmount).toLocaleString()}</p>
      </div>

      <div class="footer">
        <p>${safeFooter}</p>
        <p>${displayName}</p>
      </div>
    </body>
    </html>
  `;
};
