# A tiny CalDAV server (Radicale) so the iPhone Reminders app can sync with Pixel Pals. Built from PyPI, so nothing depends on a third-party image.
FROM python:3.12-alpine
RUN pip install --no-cache-dir "radicale>=3.2,<4"
COPY config /etc/radicale/config
COPY start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data/collections /config
VOLUME /data
EXPOSE 5232
ENTRYPOINT ["/start.sh"]
