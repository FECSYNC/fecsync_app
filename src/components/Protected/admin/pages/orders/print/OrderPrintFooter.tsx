'use client';

import type { CompanyProfile } from '@/services/companyProfile';

interface OrderPrintFooterProps {
  brand?: Pick<
    CompanyProfile,
    | 'displayName'
    | 'legalName'
    | 'tradingName'
    | 'supportEmail'
    | 'website'
    | 'phone'
    | 'bankName'
    | 'bankAccountName'
    | 'bankAccountLast4'
    | 'invoiceFooterNote'
  > | null;
}

export default function OrderPrintFooter({ brand }: OrderPrintFooterProps) {
  const companyName =
    brand?.displayName?.trim() ||
    brand?.legalName?.trim() ||
    brand?.tradingName?.trim() ||
    'Company';
  const supportEmail = brand?.supportEmail?.trim() || '';
  const website = brand?.website?.trim() || '';
  const phone = brand?.phone?.trim() || '';
  const bankSummary = [
    brand?.bankName,
    brand?.bankAccountName,
    brand?.bankAccountLast4 ? `•••• ${brand.bankAccountLast4}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const contactRows = [
    supportEmail ? { label: 'Email', value: supportEmail } : null,
    website ? { label: 'Website', value: website } : null,
    phone ? { label: 'Phone', value: phone } : null,
    bankSummary ? { label: 'Bank', value: bankSummary } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="print-footer">
      <div className="footer-content">
        <div className="thank-you-section">
          <h4 className="thank-you-title">Thank you for your business!</h4>
          <p className="thank-you-message">
            {brand?.invoiceFooterNote?.trim() ||
              `We appreciate your trust in ${companyName} for your fashion needs. If you have any questions about this order, please do not hesitate to contact us.`}
          </p>
        </div>

        {contactRows.length > 0 ? (
          <div className="contact-section">
            <h4 className="contact-title">Contact Information</h4>
            <div className="contact-details">
              {contactRows.map((row) => (
                <div className="contact-item" key={row.label}>
                  <span className="contact-label">{row.label}:</span>
                  <span className="contact-value">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="terms-section">
          <h4 className="terms-title">Terms & Conditions</h4>
          <p className="terms-text">
            This invoice is generated automatically. All prices are in US Dollars (USD).
            For any disputes or clarifications, please contact our customer service team within 7 days of order delivery.
          </p>
        </div>

        <div className="footer-bottom">
          <p className="footer-note">
            Generated on{' '}
            {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
