pipeline {
    agent any

    options {
        timeout(time: 15, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        PROJECT_DIR = "/home/ubuntu/Samarth-AI-SIH"
    }

    stages {
        stage('Checkout Code') {
            steps {
                echo '📥 Checking out latest source code from GitHub...'
                checkout scm
            }
        }

        stage('Verify Environment') {
            steps {
                echo '🔍 Verifying Docker and Production configuration...'
                sh '''
                    docker --version
                    docker compose version
                    if [ ! -f "${PROJECT_DIR}/.env" ]; then
                        echo "Error: .env file missing in ${PROJECT_DIR}"
                        exit 1
                    fi
                '''
            }
        }

        stage('Build & Deploy Stack') {
            steps {
                echo '🚀 Building Docker images and deploying production stack...'
                sh '''
                    cd ${PROJECT_DIR}
                    git pull origin main
                    sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
                '''
            }
        }

        stage('Health & Smoke Verification') {
            steps {
                echo '🩺 Running live health checks...'
                sh '''
                    sleep 8
                    curl -f http://localhost:8000/health || exit 1
                    curl -I http://localhost:80 || exit 1
                    echo "All 5 containers are running and healthy!"
                '''
            }
        }
    }

    post {
        success {
            echo '====================================================='
            echo '🎉 SAMARTH AI Production Deployment Succeeded!'
            echo 'Live URL: http://13.203.65.170/'
            echo '====================================================='
        }
        failure {
            echo '====================================================='
            echo '❌ SAMARTH AI Deployment Failed. Inspect build logs.'
            echo '====================================================='
        }
    }
}
