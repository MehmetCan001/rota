-- Rota hatırlatmaları: her dakika rota-remind fonksiyonunu çağırır.
-- Supabase > SQL Editor'de bir kez çalıştır. Tekrar çalıştırmak zararsızdır (işi yeniler).
-- Fonksiyon kendi tekrar korumasını yapar: fazladan çağrı aynı bildirimi ikinci kez göndermez.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('rota-remind', 'rota-cron-temizlik');

select cron.schedule('rota-remind', '* * * * *', $$
  select net.http_post(
    url := 'https://ywwigizfvrcsljgjcqfe.supabase.co/functions/v1/rota-remind',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
$$);

-- Zamanlayıcının çalışma kayıtları her gece temizlenir (dakikada bir satır birikmesin).
select cron.schedule('rota-cron-temizlik', '17 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
$$);

-- Kontrol: iki iş de listelenmeli.
select jobname, schedule, active from cron.job where jobname like 'rota-%';
