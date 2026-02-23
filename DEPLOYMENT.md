# LMS Marketplace — دليل النشر على VPS

## قبل أي شيء — ما تحتاجه جاهزاً

- [ ] VPS (Ubuntu 22.04 أو 24.04) — 4 vCPU، 8 GB RAM، 80 GB SSD
- [ ] دومين مشترى ومتصل بـ DNS
- [ ] الـ repository على GitHub
- [ ] قيم جميع المتغيرات في `.env.production` جاهزة

---

## الخطوة 1 — إعداد الـ VPS (أول مرة فقط)

### 1.1 تأمين الـ VPS

```bash
# تحديث الحزم
apt update && apt upgrade -y

# إنشاء مستخدم للنشر
adduser deploy
usermod -aG sudo deploy

# تعطيل الـ root login
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

### 1.2 تثبيت Docker

```bash
# تثبيت Docker من المصدر الرسمي
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# تثبيت Docker Compose plugin
apt install -y docker-compose-plugin

# تحقق من الإصدارات
docker --version       # يجب أن يكون 24+
docker compose version # يجب أن يكون 2.20+
```

### 1.3 إعداد الـ Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Let's Encrypt)
ufw allow 443/tcp   # HTTPS
ufw enable
```

---

## الخطوة 2 — تحضير الملفات على الـ VPS

```bash
# تسجيل دخول كـ deploy
su - deploy

# استنساخ المشروع
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /home/deploy/lms
cd /home/deploy/lms

# نسخ ملفات Docker إلى جذر المشروع
# (انسخ ملفات هذا المجلد إلى /home/deploy/lms/)

# إنشاء ملف البيئة
cp .env.production.example .env.production
nano .env.production  # عدّل جميع قيم CHANGE_THIS

# تأمين ملف البيئة
chmod 600 .env.production

# إنشاء مجلد النسخ الاحتياطية
mkdir -p /home/deploy/backups

# تحويل الـ scripts إلى ملفات قابلة للتنفيذ
chmod +x deploy.sh backup.sh entrypoint.sh
```

---

## الخطوة 3 — SSL Certificate (أول مرة فقط)

### 3.1 تشغيل Nginx على HTTP فقط أولاً

في ملف `nginx/conf.d/lms.conf`، عدّل `YOUR_DOMAIN` ثم:
- **علّق** (comment out) كامل الـ `server` block الخاص بالـ HTTPS (443)
- ابقِ فقط الـ `server` block الخاص بـ HTTP (80)

```bash
# ابدأ فقط postgres + redis + api + nginx
docker compose up -d postgres redis
sleep 10
docker compose up -d api
sleep 15
docker compose up -d nginx
```

### 3.2 احصل على الشهادة

```bash
docker compose run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d YOUR_DOMAIN \
  --email YOUR_EMAIL \
  --agree-tos \
  --no-eff-email
```

### 3.3 فعّل HTTPS

- **ألغِ التعليق** على الـ `server` block الخاص بـ HTTPS في `nginx/conf.d/lms.conf`
- تحقق أن `YOUR_DOMAIN` مكتوب في كل الأماكن

```bash
docker compose exec nginx nginx -s reload
```

### 3.4 ابدأ certbot للتجديد التلقائي

```bash
docker compose up -d certbot
```

---

## الخطوة 4 — التشغيل الكامل

```bash
cd /home/deploy/lms
docker compose up -d
```

### التحقق من الحالة

```bash
# حالة جميع الـ containers
docker compose ps

# صحة الـ API
curl https://YOUR_DOMAIN/health

# لوغات الـ worker (تأكد من LibreOffice)
docker compose logs worker | grep -i libreoffice

# لوغات مباشرة
docker compose logs -f --tail=50
```

---

## الخطوة 5 — إعداد النسخ الاحتياطي التلقائي

```bash
# افتح الـ crontab
crontab -e

# أضف هذا السطر (نسخة احتياطية كل 6 ساعات)
0 */6 * * * /home/deploy/lms/backup.sh >> /var/log/lms-backup.log 2>&1
```

---

## الخطوة 6 — تحديث Bunny Webhook URL

بعد ما يشتغل كل شيء:

1. اذهب إلى Bunny Stream Dashboard
2. ابحث عن إعدادات الـ Webhook
3. غيّر الـ URL من الـ Railway URL القديم إلى:
   `https://YOUR_DOMAIN/api/v1/webhooks/bunny`
4. اختبر بإرسال webhook تجريبي
5. تحقق من اللوغات: `docker compose logs api | grep -i bunny`

---

## الخطوة 7 — تحديث المتغيرات في Vercel (Frontend)

في كل من student-frontend وadmin-frontend على Vercel:
- غيّر `NEXT_PUBLIC_API_URL` (أو ما يعادله) إلى `https://YOUR_DOMAIN`
- أعد النشر (Redeploy)

---

## النشر عند التحديث

```bash
cd /home/deploy/lms
./deploy.sh
```

---

## استعادة نسخة احتياطية (في حالة الطوارئ)

```bash
# استعادة آخر نسخة
LATEST=$(ls -t /home/deploy/backups/lms_*.sql.gz | head -1)
echo "Restoring: $LATEST"

# وقف الـ API والـ Worker أولاً
docker compose stop api worker

# استعادة قاعدة البيانات
gunzip -c "$LATEST" | docker compose exec -T postgres \
  psql -U lms_user lms_production

# إعادة التشغيل
docker compose start api worker
```

---

## أوامر مفيدة يومياً

```bash
# حالة الـ containers
docker compose ps

# لوغات كل container
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f nginx

# دخول إلى shell الـ container
docker compose exec api sh
docker compose exec postgres psql -U lms_user lms_production

# إعادة تشغيل container واحد
docker compose restart api

# إيقاف وتشغيل كل شيء
docker compose down
docker compose up -d

# مساحة الـ Docker (لتنظيف الـ images القديمة)
docker system prune -f
```

---

## Top 5 مشاكل شائعة وحلولها

| المشكلة | السبب | الحل |
|---------|--------|-------|
| Worker يقع عند معالجة PDF | LibreOffice يحتاج ذاكرة أكثر | زِد memory limit للـ worker في docker-compose.yml |
| الإيميلات لا تُرسل | `BREVO_API_KEY` ناقص | أضفه في `.env.production` |
| CORS error في الـ frontend | `CORS_ORIGIN` غير صحيح | تحقق من القيمة في `.env.production` |
| قاعدة البيانات لا تتصل | `DATABASE_URL` خاطئ | تأكد أنه يشير إلى `postgres:5432` وليس Railway |
| Bunny webhook لا يصل | URL لم يتحدث في Bunny dashboard | راجع الخطوة 6 |
