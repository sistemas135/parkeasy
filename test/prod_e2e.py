import asyncio, sys, os, io, psycopg2
from playwright.async_api import async_playwright
BASE = "https://sistemas135.github.io/parkeasy/"
DSN = "host=aws-0-us-east-1.pooler.supabase.com port=5432 user=postgres.srtgixeecqclwbmjvuip dbname=postgres password=" + open(os.path.join(os.path.dirname(__file__), "..", ".dbpass")).read().strip()
SHOTS = os.path.join(os.path.dirname(__file__), "shots_prod"); os.makedirs(SHOTS, exist_ok=True)
CARD = "1010"; errors = []
def q(sql, *a):
    with psycopg2.connect(DSN) as c:
        cur = c.cursor(); cur.execute(sql, a); c.commit()
        try: return cur.fetchall()
        except Exception: return None
def jpg():
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", (640, 480), (200, 30, 30)).save(b, "JPEG"); return b.getvalue()
async def pin(page, code):
    for ch in code: await page.click(f'button[data-a="v:key"][data-v="{ch}"]')
    if len(code) < 6: await page.click('button[data-a="v:enter"]')
async def shot(page, name): await page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

async def main():
    TOKEN = q("select token from tarjetas where codigo=%s", CARD)[0][0]
    q("delete from comercio_movimientos; delete from comercio_sessions; delete from eventos; delete from visitas; delete from comercios; delete from contrato_pagos; delete from tarjetas where tipo='contrato'; delete from contratos; update tarjetas set estado='disponible', visita_actual=null")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        phone = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="es-PA")
        desk = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PA")
        runner = await phone.new_page(); runner.on("pageerror", lambda e: errors.append("runner: " + str(e)))
        runner.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        # RUNNER recibir
        await runner.goto(BASE + "#/valet"); await runner.wait_for_selector(".keys")
        await pin(runner, "1441"); await runner.wait_for_selector('[data-a="v:recibir"]')
        await runner.click('[data-a="v:recibir"]'); await runner.wait_for_selector("#codeInput")
        await runner.fill("#codeInput", CARD); await runner.click('[data-a="f:code"]'); await runner.wait_for_selector(".fotos")
        for i in range(2):
            await runner.set_input_files(f'input[data-foto="{i}"]', {"name": f"f{i}.jpg", "mimeType": "image/jpeg", "buffer": jpg()})
            await runner.wait_for_function(f"document.querySelectorAll('.foto img').length >= {i+1}")
        await runner.click('[data-a="f:fotosOk"]'); await runner.wait_for_selector("#placa")
        await runner.fill("#placa", "ab 1234"); await runner.fill("#q", "fortuner"); await runner.wait_for_selector('button[data-a="f:pick"]')
        await runner.click('button[data-a="f:pick"]'); await runner.wait_for_selector(".nivel"); await runner.click('button[data-a="f:color"][data-v="Blanco"]')
        await runner.click('[data-a="f:datosOk"]'); await runner.wait_for_selector('[data-a="f:estacionado"]')
        await runner.click('[data-a="f:estacionado"]'); await runner.wait_for_selector("#selPlaza")
        await runner.click('[data-a="f:ubicar"]'); await runner.wait_for_selector('text=Listo ·'); await shot(runner, "09-listo")
        await runner.click('[data-a="v:cancelflow"]')
        # CLIENTE
        cli = await phone.new_page(); cli.on("pageerror", lambda e: errors.append("cliente: " + str(e)))
        await cli.goto(BASE + "#/t/" + TOKEN); await cli.wait_for_selector('[data-a="c:pedir"]')
        await cli.wait_for_selector("text=Tarifa actual"); await cli.click('[data-a="c:tarifario"]'); await cli.wait_for_selector(".overlay"); await shot(cli, "10b-tarifario")
        await cli.click('.sheet [data-a="c:cerrarSheet"]'); await cli.wait_for_selector(".overlay", state="detached"); await shot(cli, "10-ticket")
        await cli.click('[data-a="c:pedir"]'); await cli.wait_for_selector('[data-a="c:pago"]'); await cli.click('button[data-a="c:when"][data-v="5"]')
        await cli.click('[data-a="c:pago"]'); await cli.wait_for_selector('[data-a="c:pay"]')
        await cli.click('button[data-a="c:tip"][data-v="3"]'); await cli.click('button[data-a="c:method"][data-v="yappy"]'); await shot(cli, "12-pago")
        await cli.click('[data-a="c:pay"]'); await cli.wait_for_selector(".eta"); await shot(cli, "13-estado")
        # TABLERO
        tab = await desk.new_page(); tab.on("pageerror", lambda e: errors.append("tablero: " + str(e)))
        tab.on("dialog", lambda d: asyncio.ensure_future(d.accept("YP-TEST-1")))
        await tab.goto(BASE + "#/tablero"); await tab.wait_for_selector(".keys"); await pin(tab, "7023"); await tab.wait_for_selector(".desk-body")
        await tab.wait_for_selector('button[data-a="d:confirmar"]'); await tab.click('button[data-a="d:confirmar"]'); await tab.wait_for_selector("text=Pagado · Yappy"); await shot(tab, "15-tablero")
        # RUNNER entregar
        await runner.click('button[data-a="v:tab"][data-v="cola"]'); await runner.wait_for_selector('button[data-a="v:tomar"]')
        await runner.click('button[data-a="v:tomar"]'); await runner.wait_for_selector('button[data-a="v:puerta"]'); await runner.click('button[data-a="v:puerta"]')
        await runner.wait_for_selector('button[data-a="v:entregar"]'); await runner.click('button[data-a="v:entregar"]'); await runner.wait_for_selector("#codeBack")
        await runner.fill("#codeBack", CARD); await runner.click('[data-a="e:entregar"]'); await runner.wait_for_selector(".toast")
        await cli.wait_for_selector(".stars", timeout=20000); await cli.click('button[data-a="c:star"][data-v="5"]'); await cli.wait_for_selector(".toast")
        # ADMIN + CONTRATOS
        desk2 = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PA")
        adm = await desk2.new_page(); adm.on("pageerror", lambda e: errors.append("admin: " + str(e)))
        adm.on("dialog", lambda d: asyncio.ensure_future(d.accept("")))
        await adm.goto(BASE + "#/admin"); await adm.wait_for_selector(".keys"); await pin(adm, "813235"); await adm.wait_for_selector(".kpi"); await shot(adm, "20-admin")
        await adm.click('button[data-a="a:nav"][data-v="tarifas"]'); await adm.wait_for_selector("#tr_h0")
        assert await adm.input_value("#tr_h0") == "4" and await adm.input_value("#tr_p3") == "60", "tramos no cargados"
        await shot(adm, "21-tarifas")
        await adm.click('button[data-a="a:nav"][data-v="contratos"]'); await adm.wait_for_selector("#k_nombre")
        await adm.fill("#k_nombre", "Contrato Prueba"); await adm.fill("#k_empresa", "Empresa X"); await adm.fill("#k_placas", "zz 9999")
        await adm.click('[data-a="a:nuevoContrato"]'); await adm.wait_for_selector("text=Contrato Prueba"); await adm.wait_for_timeout(800); await shot(adm, "24-contratos")
        codigo = await adm.eval_on_selector("tr:has-text('Contrato Prueba') .tag.ok", "e=>e.textContent"); assert codigo.startswith("9"), codigo
        ctoken = q("select token from tarjetas where codigo=%s", codigo)[0][0]
        await runner.click('[data-a="v:recibir"]'); await runner.wait_for_selector("#codeInput"); await runner.fill("#codeInput", codigo); await runner.click('[data-a="f:code"]')
        await runner.wait_for_selector(".fotos", timeout=20000)
        await runner.set_input_files('input[data-foto="0"]', {"name": "c.jpg", "mimeType": "image/jpeg", "buffer": jpg()}); await runner.wait_for_function("document.querySelectorAll('.foto img').length >= 1")
        await runner.click('[data-a="f:fotosOk"]'); await runner.wait_for_selector("#placa")
        assert (await runner.input_value("#placa")) == "ZZ 9999", "placa no precargada"
        await runner.fill("#q", "kia rio"); await runner.wait_for_selector('button[data-a="f:pick"]'); await runner.click('button[data-a="f:pick"]')
        await runner.click('[data-a="f:datosOk"]'); await runner.wait_for_selector("text=CONTRATO"); await shot(runner, "25-runner-contrato")
        await runner.click('[data-a="f:estacionado"]'); await runner.wait_for_selector("#selPlaza"); await runner.click('[data-a="f:ubicar"]'); await runner.wait_for_selector("text=Listo ·"); await runner.click('[data-a="v:cancelflow"]')
        cc = await phone.new_page(); cc.on("pageerror", lambda e: errors.append("contrato: " + str(e)))
        await cc.goto(BASE + "#/t/" + ctoken); await cc.wait_for_selector("text=Contrato · sin cargo"); await shot(cc, "26-cliente-contrato")
        txt = await cc.inner_text("#app"); assert "$" not in txt, "cliente de contrato ve precios"
        await cc.click('[data-a="c:pedir"]'); await cc.wait_for_selector('[data-a="c:pay"]'); await cc.click('[data-a="c:pay"]'); await cc.wait_for_selector(".eta")
        await runner.click('button[data-a="v:tab"][data-v="cola"]'); await runner.wait_for_selector("text=Contrato · sin cargo")
        await runner.click('button[data-a="v:tomar"]'); await runner.wait_for_selector('button[data-a="v:puerta"]'); await runner.click('button[data-a="v:puerta"]')
        await runner.wait_for_selector('button[data-a="v:entregar"]'); await runner.click('button[data-a="v:entregar"]'); await runner.wait_for_selector("#codeBack")
        await runner.fill("#codeBack", codigo); await runner.click('[data-a="e:entregar"]'); await runner.wait_for_selector(".toast")
        await adm.click('button[data-a="a:nav"][data-v="contratos"]'); await adm.wait_for_selector('[data-a="a:contratoCuenta"]'); await adm.click('[data-a="a:contratoCuenta"]')
        await adm.wait_for_selector(".overlay .kpi"); await shot(adm, "28-cuenta")
        await adm.click('[data-a="a:contratoMarcarPago"]'); await adm.wait_for_selector('.overlay .note.ok'); await adm.wait_for_timeout(1500)
        for _ in range(3):
            if not await adm.query_selector('.overlay'): break
            await adm.click('.overlay [data-a="d:cerrar"]'); await adm.wait_for_timeout(500)
        # ---------- COMERCIOS ALIADOS ----------
        q("update tarjetas set estado='disponible', visita_actual=null where codigo='1020'")
        await adm.click('button[data-a="a:nav"][data-v="comercios"]'); await adm.wait_for_selector("#co_nombre")
        await adm.fill("#co_nombre", "Comercio Prueba"); await adm.fill("#co_contacto", "Ana"); await adm.fill("#co_pin", "2468"); await adm.fill("#co_ref", "VISA 1234")
        await adm.click('[data-a="a:nuevoComercio"]'); await adm.wait_for_selector("text=Comercio Prueba"); await adm.wait_for_timeout(800); await shot(adm, "30-admin-comercios")
        assert "$300.00" in (await adm.inner_text("table")), "saldo inicial no registrado"
        await runner.click('[data-a="v:recibir"]'); await runner.wait_for_selector("#codeInput"); await runner.fill("#codeInput", "1020"); await runner.click('[data-a="f:code"]'); await runner.wait_for_selector(".fotos", timeout=20000)
        await runner.set_input_files('input[data-foto="0"]', {"name": "a.jpg", "mimeType": "image/jpeg", "buffer": jpg()}); await runner.wait_for_function("document.querySelectorAll('.foto img').length >= 1")
        await runner.click('[data-a="f:fotosOk"]'); await runner.wait_for_selector("#placa"); await runner.fill("#placa", "xy 5555"); await runner.fill("#q", "corolla"); await runner.wait_for_selector('button[data-a="f:pick"]'); await runner.click('button[data-a="f:pick"]')
        await runner.click('[data-a="f:datosOk"]'); await runner.wait_for_selector('[data-a="f:estacionado"]'); await runner.click('[data-a="f:estacionado"]'); await runner.wait_for_selector("#selPlaza"); await runner.click('[data-a="f:ubicar"]'); await runner.wait_for_selector("text=Listo ·"); await runner.click('[data-a="v:cancelflow"]')
        al = await phone.new_page(); al.on("pageerror", lambda e: errors.append("aliado: " + str(e)))
        await al.goto(BASE + "#/aliado"); await al.wait_for_selector(".keys")
        await pin(al, "2468"); await al.wait_for_selector('[data-a="l:scan"]'); await al.wait_for_selector("text=$300.00"); await shot(al, "32-aliado-home")
        await al.click('[data-a="l:scan"]'); await al.wait_for_selector("#codeAli"); await al.fill("#codeAli", "1020"); await al.click('[data-a="l:code"]'); await al.wait_for_selector('[data-a="l:validar"]'); await shot(al, "33-aliado-confirmar")
        await al.click('[data-a="l:validar"]'); await al.wait_for_selector("text=Validada ·"); await shot(al, "34-aliado-validada")
        t1020 = q("select token from tarjetas where codigo='1020'")[0][0]
        cc2 = await phone.new_page(); cc2.on("pageerror", lambda e: errors.append("cliente-aliado: " + str(e)))
        await cc2.goto(BASE + "#/t/" + t1020); await cc2.wait_for_selector("text=Cortesía de Comercio Prueba"); await shot(cc2, "36-cliente-cortesia")
        await cc2.click('[data-a="c:pedir"]'); await cc2.wait_for_selector("text=sin cargo"); await cc2.click('[data-a="c:pay"]'); await cc2.wait_for_selector(".eta")
        await runner.click('button[data-a="v:tab"][data-v="cola"]'); await runner.wait_for_selector("text=Cortesía · Comercio Prueba")
        await runner.click('button[data-a="v:tomar"]'); await runner.wait_for_selector('button[data-a="v:puerta"]'); await runner.click('button[data-a="v:puerta"]')
        await runner.wait_for_selector('button[data-a="v:entregar"]'); await runner.click('button[data-a="v:entregar"]'); await runner.wait_for_selector("#codeBack")
        await runner.fill("#codeBack", "1020"); await runner.click('[data-a="e:entregar"]'); await runner.wait_for_selector(".toast")
        await adm.click('button[data-a="a:nav"][data-v="comercios"]'); await adm.wait_for_selector('[data-a="a:comercioCuenta"]'); await adm.click('[data-a="a:comercioCuenta"]')
        await adm.wait_for_selector(".overlay .kpi"); txt = await adm.inner_text(".overlay"); assert "$295.00" in txt, txt; await shot(adm, "40-admin-cuenta-comercio"); await adm.click('.overlay [data-a="d:cerrar"]')
        await browser.close()
    print("ERRORS:", errors if errors else "none")
    return 1 if errors else 0
sys.exit(asyncio.run(main()))
