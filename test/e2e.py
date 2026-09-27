import asyncio, sys, os, io, subprocess
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787/"
SHOTS = os.path.join(os.path.dirname(__file__), "shots"); os.makedirs(SHOTS, exist_ok=True)
CARD = "1010"
TOKEN = subprocess.check_output(["psql", "-h", "/tmp", "-p", "5499", "-U", "postgres", "-d", "pe", "-tA", "-c", f"select token from tarjetas where codigo='{CARD}'"]).decode().strip()
errors = []

def jpg():
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", (640, 480), (200, 30, 30)).save(b, "JPEG"); return b.getvalue()

async def pin(page, code):
    for ch in code:
        await page.click(f'button[data-a="v:key"][data-v="{ch}"]')
    if len(code) < 6:
        await page.click('button[data-a="v:enter"]')

async def shot(page, name):
    await page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        phone = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="es-PA")
        desk = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PA")
        for ctx in (phone, desk):
            ctx.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(str(e))))
        runner = await phone.new_page(); runner.on("pageerror", lambda e: errors.append("runner: " + str(e)))
        runner.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
        # limpiar visitas previas de la tarjeta de prueba
        subprocess.run(["psql", "-h", "/tmp", "-p", "5499", "-U", "postgres", "-d", "pe", "-q", "-c", f"update tarjetas set estado='disponible', visita_actual=null where codigo='{CARD}'"])

        # ---------- RUNNER: recibir ----------
        await runner.goto(BASE + "#/valet"); await runner.wait_for_selector(".keys")
        await shot(runner, "01-pin")
        await pin(runner, "1111"); await runner.wait_for_selector('[data-a="v:recibir"]')
        await shot(runner, "02-runner-home")
        await runner.click('[data-a="v:recibir"]'); await runner.wait_for_selector("#codeInput")
        await runner.fill("#codeInput", CARD); await runner.click('[data-a="f:code"]')
        await runner.wait_for_selector(".fotos"); await shot(runner, "03-fotos")
        for i in range(2):
            await runner.set_input_files(f'input[data-foto="{i}"]', {"name": f"f{i}.jpg", "mimeType": "image/jpeg", "buffer": jpg()})
            await runner.wait_for_function(f"document.querySelectorAll('.foto img').length >= {i+1}")
        await shot(runner, "04-fotos-subidas")
        await runner.click('[data-a="f:fotosOk"]'); await runner.wait_for_selector("#placa")
        await runner.fill("#placa", "ab 1234")
        await runner.fill("#q", "fortuner"); await runner.wait_for_selector('button[data-a="f:pick"]')
        await shot(runner, "05-buscar")
        await runner.click('button[data-a="f:pick"]'); await runner.wait_for_selector(".nivel")
        await runner.click('button[data-a="f:color"][data-v="Blanco"]')
        await shot(runner, "06-datos")
        await runner.click('[data-a="f:datosOk"]'); await runner.wait_for_selector('[data-a="f:estacionado"]')
        await shot(runner, "07-estacionar")
        await runner.click('[data-a="f:estacionado"]'); await runner.wait_for_selector("#selPlaza")
        await shot(runner, "08-ubicar")
        await runner.click('[data-a="f:ubicar"]'); await runner.wait_for_selector('text=Listo ·')
        await shot(runner, "09-listo")
        await runner.click('[data-a="v:cancelflow"]')

        # ---------- CLIENTE ----------
        cli = await phone.new_page(); cli.on("pageerror", lambda e: errors.append("cliente: " + str(e)))
        await cli.goto(BASE + "#/t/" + TOKEN); await cli.wait_for_selector('[data-a="c:pedir"]')
        await cli.wait_for_selector("text=Tarifa actual"); await cli.click('[data-a="c:tarifario"]'); await cli.wait_for_selector(".overlay"); await shot(cli, "10b-tarifario"); await cli.click('.sheet [data-a="c:cerrarSheet"]'); await cli.wait_for_selector(".overlay", state="detached")
        await shot(cli, "10-cliente-ticket")
        await cli.click('[data-a="c:pedir"]'); await cli.wait_for_selector('[data-a="c:pago"]')
        await cli.click('button[data-a="c:when"][data-v="5"]'); await shot(cli, "11-cliente-cuando")
        await cli.click('[data-a="c:pago"]'); await cli.wait_for_selector('[data-a="c:pay"]')
        await cli.click('button[data-a="c:tip"][data-v="3"]'); await cli.click('button[data-a="c:method"][data-v="yappy"]')
        await shot(cli, "12-cliente-pago")
        await cli.click('[data-a="c:pay"]'); await cli.wait_for_selector(".eta")
        await shot(cli, "13-cliente-estado")

        # ---------- TABLERO: confirmar pago ----------
        tab = await desk.new_page(); tab.on("pageerror", lambda e: errors.append("tablero: " + str(e)))
        tab.on("dialog", lambda d: asyncio.ensure_future(d.accept("YP-TEST-1")))
        await tab.goto(BASE + "#/tablero"); await tab.wait_for_selector(".keys")
        await pin(tab, "2222"); await tab.wait_for_selector(".desk-body")
        await tab.wait_for_selector('button[data-a="d:confirmar"]')
        await shot(tab, "14-tablero")
        await tab.click('button[data-a="d:confirmar"]')
        await tab.wait_for_selector("text=Pagado · Yappy")
        await shot(tab, "15-tablero-confirmado")

        # ---------- RUNNER: entregar ----------
        await runner.click('button[data-a="v:tab"][data-v="cola"]')
        await runner.wait_for_selector('button[data-a="v:tomar"]'); await shot(runner, "16-cola")
        await runner.click('button[data-a="v:tomar"]'); await runner.wait_for_selector('button[data-a="v:puerta"]')
        await runner.click('button[data-a="v:puerta"]'); await runner.wait_for_selector('button[data-a="v:entregar"]')
        await runner.click('button[data-a="v:entregar"]'); await runner.wait_for_selector("#codeBack")
        await shot(runner, "17-entrega")
        await runner.fill("#codeBack", "9999"); await runner.click('[data-a="e:entregar"]')
        await runner.wait_for_selector("text=Esa no es la tarjeta")
        await runner.fill("#codeBack", CARD); await runner.click('[data-a="e:entregar"]')
        await runner.wait_for_selector(".toast"); await shot(runner, "18-entregado")

        # ---------- CLIENTE: gracias ----------
        await cli.wait_for_selector(".stars", timeout=15000); await cli.click('button[data-a="c:star"][data-v="5"]')
        await cli.wait_for_selector(".toast"); await shot(cli, "19-cliente-gracias")

        # ---------- ADMIN ----------
        # el tablero (capitán) no puede entrar a admin
        na = await desk.new_page(); await na.goto(BASE + "#/admin"); await na.wait_for_selector("text=Sin acceso"); await shot(na, "19b-capitan-sin-acceso"); await na.close()
        desk2 = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PA")
        adm = await desk2.new_page(); adm.on("pageerror", lambda e: errors.append("admin: " + str(e)))
        adm.on("dialog", lambda d: asyncio.ensure_future(d.accept("")))
        await adm.goto(BASE + "#/admin"); await adm.wait_for_selector(".keys")
        await pin(adm, "123456"); await adm.wait_for_selector(".kpi")
        await shot(adm, "20-admin-resumen")
        for nav in ["visitas", "corte", "personal", "tarifas", "contratos", "tarjetas", "modelos"]:
            await adm.click(f'button[data-a="a:nav"][data-v="{nav}"]'); await adm.wait_for_selector(".panel"); await adm.wait_for_timeout(600)
            await shot(adm, "21-admin-" + nav)
        await adm.click('button[data-a="a:nav"][data-v="tarjetas"]'); await adm.wait_for_selector("#p_desde")
        await adm.fill("#p_desde", "1001"); await adm.fill("#p_hasta", "1004"); await adm.click('[data-a="a:imprimir"]')
        await adm.wait_for_selector(".card-print img"); await shot(adm, "22-admin-tarjetas-print")
        # PIN change flow
        await adm.click('button[data-a="a:nav"][data-v="personal"]'); await adm.wait_for_selector("#s_nombre")
        await adm.fill("#s_nombre", "Runner Prueba"); await adm.fill("#s_pin", "5555"); await adm.click('[data-a="a:nuevoStaff"]')
        await adm.wait_for_selector("text=Runner Prueba")
        # ---------- CONTRATOS: tarifas + contrato + tarjeta fija ----------
        await adm.click('button[data-a="a:nav"][data-v="tarifas"]'); await adm.wait_for_selector("#tr_h0")
        assert await adm.input_value("#tr_h0") == "4" and await adm.input_value("#tr_p3") == "60", "tramos no cargados"
        await adm.click('[data-a="a:saveTarifas"]'); await adm.wait_for_selector(".toast")
        await adm.click('button[data-a="a:nav"][data-v="contratos"]'); await adm.wait_for_selector("#k_nombre")
        await adm.fill("#k_nombre", "Contrato Prueba"); await adm.fill("#k_empresa", "Empresa X"); await adm.fill("#k_placas", "zz 9999")
        await adm.click('[data-a="a:nuevoContrato"]'); await adm.wait_for_selector("text=Contrato Prueba"); await adm.wait_for_timeout(500)
        await shot(adm, "24-admin-contratos")
        codigo = await adm.eval_on_selector("tr:has-text('Contrato Prueba') .tag.ok", "e=>e.textContent")
        assert codigo.startswith("9"), codigo
        ctoken = subprocess.check_output(["psql", "-h", "/tmp", "-p", "5499", "-U", "postgres", "-d", "pe", "-tA", "-c", f"select token from tarjetas where codigo='{codigo}'"]).decode().strip()
        # runner recibe con tarjeta de contrato
        await runner.click('[data-a="v:recibir"]'); await runner.wait_for_selector("#codeInput"); await runner.fill("#codeInput", codigo); await runner.click('[data-a="f:code"]')
        try:
            await runner.wait_for_selector(".fotos", timeout=15000)
        except Exception:
            print("RUNNER PAGE:", await runner.inner_text("#app")); raise
        await runner.set_input_files('input[data-foto="0"]', {"name": "c.jpg", "mimeType": "image/jpeg", "buffer": jpg()})
        await runner.wait_for_function("document.querySelectorAll('.foto img').length >= 1")
        await runner.click('[data-a="f:fotosOk"]'); await runner.wait_for_selector("#placa")
        assert (await runner.input_value("#placa")) == "ZZ 9999", "placa del contrato no precargada"
        await runner.fill("#q", "kia rio"); await runner.wait_for_selector('button[data-a="f:pick"]'); await runner.click('button[data-a="f:pick"]')
        await runner.click('[data-a="f:datosOk"]'); await runner.wait_for_selector("text=CONTRATO"); await shot(runner, "25-runner-contrato")
        await runner.click('[data-a="f:estacionado"]'); await runner.wait_for_selector("#selPlaza"); await runner.click('[data-a="f:ubicar"]'); await runner.wait_for_selector("text=Listo ·"); await runner.click('[data-a="v:cancelflow"]')
        # cliente de contrato: sin precios, pide directo
        cc = await phone.new_page(); cc.on("pageerror", lambda e: errors.append("contrato: " + str(e)))
        await cc.goto(BASE + "#/t/" + ctoken); await cc.wait_for_selector("text=Contrato · sin cargo"); await shot(cc, "26-cliente-contrato")
        txt = await cc.inner_text("#app"); assert "$" not in txt, "el cliente de contrato ve precios: " + txt
        await cc.click('[data-a="c:pedir"]'); await cc.wait_for_selector('[data-a="c:pay"]'); await cc.click('[data-a="c:pay"]'); await cc.wait_for_selector(".eta"); await shot(cc, "27-cliente-contrato-estado")
        await runner.click('button[data-a="v:tab"][data-v="cola"]'); await runner.wait_for_selector("text=Contrato · sin cargo")
        await runner.click('button[data-a="v:tomar"]'); await runner.wait_for_selector('button[data-a="v:puerta"]'); await runner.click('button[data-a="v:puerta"]')
        await runner.wait_for_selector('button[data-a="v:entregar"]'); await runner.click('button[data-a="v:entregar"]'); await runner.wait_for_selector("#codeBack")
        await runner.fill("#codeBack", codigo); await runner.click('[data-a="e:entregar"]'); await runner.wait_for_selector(".toast")
        await adm.click('button[data-a="a:nav"][data-v="contratos"]'); await adm.wait_for_selector('[data-a="a:contratoCuenta"]'); await adm.click('[data-a="a:contratoCuenta"]')
        await adm.wait_for_selector(".overlay .kpi"); await shot(adm, "28-admin-cuenta")
        await adm.click('[data-a="a:contratoMarcarPago"]'); await adm.wait_for_selector("text=Pagado"); await adm.click('.overlay [data-a="d:cerrar"]')
        # runner con rol no puede entrar al admin
        desk3 = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-PA")
        r2 = await desk3.new_page(); await r2.goto(BASE + "#/admin"); await r2.wait_for_selector(".keys")
        await pin(r2, "5555"); await r2.wait_for_selector(".toast"); await shot(r2, "23-admin-sin-acceso")
        await browser.close()
    print("ERRORS:", errors if errors else "none")
    return 1 if errors else 0

sys.exit(asyncio.run(main()))
