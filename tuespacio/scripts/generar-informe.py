"""Exporta el informe Markdown a PDF con texto seleccionable; requiere pycairo."""
from pathlib import Path
import re
import sys


def main():
    try:
        import cairo
    except ImportError:
        raise SystemExit('La exportación opcional requiere pycairo. El informe fuente está en docs/INFORME_IMPLEMENTACION.md.')
    root=Path(__file__).resolve().parents[1]
    output=root/'docs/INFORME_IMPLEMENTACION.pdf'
    surface=cairo.PDFSurface(str(output),595,842)
    if hasattr(surface,'set_metadata'):
        surface.set_metadata(cairo.PDF_METADATA_TITLE,'Tu Espacio · Informe de implementación')
    ctx=cairo.Context(surface)
    page,y=0,0

    def font(size,bold=False):
        ctx.select_font_face('DejaVu Sans',cairo.FONT_SLANT_NORMAL,cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
        ctx.set_font_size(size)

    def footer():
        font(8)
        ctx.set_source_rgb(.35,.41,.37)
        ctx.move_to(48,809);ctx.show_text('Tu Espacio · Sistemas Distribuidos · Prototipo académico')
        ctx.move_to(530,809);ctx.show_text(str(page))

    def next_page():
        nonlocal page,y
        if page:
            footer();ctx.show_page()
        page+=1;y=67
        ctx.set_source_rgb(1,1,1);ctx.paint()
        ctx.set_source_rgb(.08,.19,.17);ctx.rectangle(0,0,595,7);ctx.fill()
        font(9,True);ctx.move_to(48,35);ctx.show_text('TU ESPACIO')
        font(8);ctx.move_to(350,35);ctx.show_text('Informe de implementación · 2026')

    def text_lines(text,size,bold=False):
        font(size,bold)
        words=text.split();lines=[];current=''
        for word in words:
            candidate=(current+' '+word).strip()
            if ctx.text_extents(candidate).width>499 and current:
                lines.append(current);current=word
            else:current=candidate
        if current:lines.append(current)
        return lines

    next_page()
    blocks=[]
    for paragraph in (root/'docs/INFORME_IMPLEMENTACION.md').read_text().split('\n\n'):
        blocks.extend(paragraph.splitlines() if paragraph.startswith('- ') else [paragraph])
    for paragraph in blocks:
        paragraph=paragraph.strip()
        if not paragraph:continue
        is_heading=paragraph.startswith('#')
        level=len(paragraph)-len(paragraph.lstrip('#')) if is_heading else 0
        size=25 if level==1 else 14 if is_heading else 10.5
        content=re.sub(r'^#+\s*','',paragraph).replace('\n',' ')
        lines=text_lines(content,size,is_heading)
        leading=size*1.5
        if y+leading*min(len(lines),3)+(18 if is_heading else 0)>780:next_page()
        if is_heading:y+=12
        for line in lines:
            if y+leading>780:next_page()
            font(size,is_heading)
            ctx.set_source_rgb(*((.08,.24,.17) if is_heading else (.12,.16,.14)))
            ctx.move_to(48,y);ctx.show_text(line);y+=leading
        y+=10 if not is_heading else 5
    footer();surface.finish()
    print(f'Informe exportado: {output} ({page} páginas)')


if __name__=='__main__':
    main()
