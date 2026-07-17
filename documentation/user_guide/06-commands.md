cd smart-regression-optimizer

git pull
docker compose up -d --build

docker compose ps
curl http://localhost:8000/health
curl http://localhost/
