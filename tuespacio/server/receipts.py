"""Immutable payment evidence. This is not an electronic tax invoice."""
from html import escape
import os
import hashlib
import base64
from pathlib import Path

STYLE = (Path(__file__).resolve().parent.parent / "web/receipt.css").read_text()
STYLE_HASH = base64.b64encode(hashlib.sha256(STYLE.encode()).digest()).decode()
from .common import now, require


def snapshot(booking, payment):
    demo = payment.get('provider', 'demo') == 'demo'
    return {'id': 'REC-' + booking['id'].removeprefix('r-').upper(), 'bookingId': booking['id'], 'code': booking['code'],
            'issuedAt': payment.get('paidAt', now()), 'provider': payment.get('provider', 'demo'), 'demo': demo,
            'live': payment.get('live', False), 'transactionId': payment.get('providerId', booking['id']),
            'seller': os.environ.get('RECEIPT_SELLER_NAME', 'Tu Espacio · demostración' if demo else 'Tu Espacio'),
            'sellerTaxId': os.environ.get('RECEIPT_SELLER_TAX_ID', ''), 'buyer': booking['driverName'],
            'space': booking['space']['name'], 'address': booking['space']['address'], 'startAt': booking['startAt'],
            'durationMin': booking['durationMin'], 'amount': booking['amount'], 'tax': booking['tax'],
            'subtotal': booking['subtotal'], 'currency': booking['currency'], 'region': booking['region']}


def render(receipt, booking):
    """Standalone UTF-8 HTML: save, print, or choose Save as PDF in the browser."""
    esc = lambda value: escape(str(value), quote=True)
    rows = [('Recibo / Receipt', receipt['id']), ('Reserva / Booking', receipt['code']), ('Emitido / Issued', receipt['issuedAt']),
            ('Comercio / Seller', receipt['seller']), ('Identificación / Tax ID', receipt['sellerTaxId']),
            ('Cliente / Customer', receipt['buyer']), ('Parqueadero / Parking', receipt['space']), ('Dirección / Address', receipt['address']),
            ('Llegada / Arrival (UTC)', receipt['startAt']), ('Duración / Duration (min)', receipt['durationMin']),
            ('Pasarela / Provider', receipt['provider']), ('Transacción / Transaction', receipt['transactionId']),
            ('Estado actual / Current status', booking['payment']['status'])]
    factor = 100 if receipt['currency'] in ['BRL', 'USD', 'EUR'] else 1
    for label, key in [('Subtotal', 'subtotal'), ('Impuestos incluidos / Tax included', 'tax'), ('Total', 'amount')]:
        rows.append((label, f"{receipt[key] / factor:,.2f} {receipt['currency']}"))
    notice = 'DEMOSTRACIÓN · No acredita un cobro real.' if receipt['demo'] else 'MODO PRUEBAS · Sin movimiento de dinero real.' if not receipt['live'] else 'Recibo de pago verificado con la pasarela.'
    return ('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Recibo ' + esc(receipt['id']) + '</title><style>' + STYLE + '</style><main><h1>Tu Espacio</h1><p>' + esc(notice) + '</p><dl>' +
            ''.join('<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' for k, v in rows if v != '') +
            '</dl><p>Este recibo no sustituye una factura electrónica fiscal. / This receipt is not a tax invoice.</p>'
            '<p>Para guardar en PDF: Imprimir → Guardar como PDF. / Print → Save as PDF.</p></main></html>').encode('utf-8')
