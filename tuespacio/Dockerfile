FROM python:3.12-slim
WORKDIR /app
COPY server/ server/
COPY web/ web/
RUN useradd --create-home espacio && mkdir /data && chown espacio /data
USER espacio
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "-m", "server.run", "--regions", "co", "--host", "0.0.0.0", "--data", "/data"]
