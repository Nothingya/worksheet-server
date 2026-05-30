// src/txt_to_pdf.js — Convert plain text to a clean PDF buffer
const PDFDocument = require('pdfkit');

async function textToPdf(text, title = '') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (title) {
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'left' });
      doc.moveDown(0.5);
    }
    doc.fontSize(10).font('Helvetica').text(text, {
      align: 'left',
      lineGap: 3,
      paragraphGap: 6,
    });
    doc.end();
  });
}

module.exports = { textToPdf };
