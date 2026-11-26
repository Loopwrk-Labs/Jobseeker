import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { getRates } from '../fx/service';
import { CalcPanel, CALC_FOOTNOTE } from './view';

type Vars = { user: SessionUser | null };
export const calculatorRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

calculatorRoutes.get('/calculator', async (c) => {
  const user = c.get('user') as SessionUser;
  const fx = await getRates(c.env.DB);
  return c.html(
    <Layout title="Kalkulator" active="calculator" user={user}>
      <Topbar crumb={<b>Kalkulator · bruto, neto i contractor</b>} />
      <div class="content" style="max-width:1000px">
        <div class="page-head">
          <div>
            <h1>Kalkulator zarade</h1>
            <div class="sub">Plata u Srbiji, paušal, preduzetnik na knjigama, DOO i frilenser bez firme, sa troškovima firme i načinom isplate (banka, Wise, Payoneer, PayPal). Parametri za 2026.</div>
          </div>
        </div>
        <div class="panel">
          <CalcPanel fx={fx} />
        </div>
        <div class="faint calc-foot">{CALC_FOOTNOTE}</div>
      </div>
      <script src="/calculator.js" defer></script>
    </Layout>,
  );
});
