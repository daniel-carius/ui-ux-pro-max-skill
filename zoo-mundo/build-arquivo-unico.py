#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera uma versão do Zoo Mundo em um único arquivo HTML.

Junta o CSS e todos os scripts listados no index.html (na mesma ordem) para
facilitar compartilhar ou publicar o jogo. O jogo original continua sendo o
index.html com os arquivos separados.

    python3 build-arquivo-unico.py [saida.html] [--artifact]

Com --artifact, gera só o conteúdo (sem <!DOCTYPE>, <html>, <head> e <body>),
formato aceito por páginas hospedadas que já fornecem esse esqueleto.
"""
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))


def construir(saida, so_conteudo=False):
    html = ler('index.html')
    corpo = html[html.index('<div id="app">'):html.index('<!-- Dados -->')]
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    js = '\n'.join('/* ===== %s ===== */\n%s' % (s, ler(s)) for s in scripts)

    modelo = MODELO_CONTEUDO if so_conteudo else MODELO
    with open(saida, 'w', encoding='utf-8') as f:
        f.write(modelo.format(css=ler('css/estilo.css'), corpo=corpo, js=js))

    print('%s (%d KB, %d scripts)' % (saida, os.path.getsize(saida) / 1024, len(scripts)))


def ler(caminho):
    with open(os.path.join(BASE, caminho), encoding='utf-8') as f:
        return f.read()


MODELO = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#2f9e63">
<title>Zoo Mundo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
{corpo}
<script>
{js}
</script>
</body>
</html>
"""


MODELO_CONTEUDO = """<title>Zoo Mundo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
{css}
</style>

{corpo}
<script>
{js}
</script>
"""


if __name__ == '__main__':
    argumentos = [a for a in sys.argv[1:] if a != '--artifact']
    construir(argumentos[0] if argumentos else os.path.join(BASE, 'zoo-mundo-completo.html'),
              '--artifact' in sys.argv)
