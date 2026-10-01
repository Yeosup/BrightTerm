# BrightTerm 개인정보처리방침 / Privacy Policy

시행일: 2026-10-01

## 한국어

BrightTerm(이하 "앱")은 개인정보를 **수집·전송·판매하지 않습니다.**

- **저장 위치**: 사용자가 입력한 서버 목록, 계정, 비밀번호, 개인 키, 설정은 사용자의 기기에만 저장됩니다. 비밀번호와 키는 사용자가 정한 마스터 비밀번호로 암호화(scrypt + AES-256-GCM)됩니다. 개발자는 이 데이터에 접근할 수 없습니다.
- **네트워크 통신**: 앱은 사용자가 지정한 서버(SSH·Telnet·SFTP)에 직접 접속합니다. 이 통신은 개발자 서버를 거치지 않습니다.
- **배너 목록**: 앱은 시작할 때 모두의 앱(`moduapp.kr`)에서 배너 목록과 배너 이미지를 한 번 내려받습니다(1.0.0은 GitHub의 `banners/feed.json`). 이 요청에는 서버 목록·계정·기기 식별자 등 어떤 정보도 담지 않습니다. 받는 쪽은 일반적인 웹 요청과 마찬가지로 IP 주소와 앱 버전(User-Agent)을 볼 수 있으며, 모두의 앱은 배너 노출·클릭 횟수를 IP를 그대로 저장하지 않는 방식(해시)으로 집계합니다.
- **새 버전 확인**(1.2.3부터): 앱은 시작할 때와 12시간마다 GitHub에 공개된 최신 릴리스 정보를 확인합니다. 이 요청에도 어떤 정보도 담지 않으며, GitHub는 IP 주소와 앱 버전(User-Agent)을 볼 수 있습니다. 설정 → 정보에서 끌 수 있고, 앱이 스스로 내려받거나 설치하지 않습니다.
- **AWS 가져오기**: 사용자가 이 기능을 실행하면 사용자 기기에 설치된 AWS CLI가 사용자의 자격 증명으로 AWS에 직접 요청합니다. 결과는 사용자 기기에만 저장됩니다.
- **배너 클릭**: 배너를 누르면 기본 브라우저로 광고주 사이트가 열립니다. 이후는 해당 사이트의 방침을 따릅니다.
- 분석 도구, 추적 쿠키, 광고 식별자, 원격 로그 수집을 사용하지 않습니다.

문의: https://github.com/Yeosup/BrightTerm/issues

## English

BrightTerm ("the app") does **not collect, transmit, or sell personal data.**

- Server lists, accounts, passwords, private keys and settings are stored only on your device. Secrets are encrypted with your master password (scrypt + AES-256-GCM). The developer has no access to them.
- The app connects directly to servers you specify (SSH, Telnet, SFTP); this traffic never passes through the developer.
- On start-up the app downloads a banner list and banner images from moduapp.kr once (1.0.0 reads `banners/feed.json` on GitHub). The request contains no server, account or device identifiers; like any web request, the receiver can see your IP address and the app version (User-Agent). moduapp.kr counts banner reach and clicks using hashed IPs, not raw IPs.
- Update check (1.2.3+): on start-up and every 12 hours the app reads the latest public release info from GitHub. The request contains no identifiers; GitHub can see your IP address and app version. It can be turned off in Settings → About, and the app never downloads or installs anything by itself.
- "AWS import" runs the AWS CLI installed on your device with your own credentials; results stay on your device.
- Clicking a banner opens the advertiser's site in your default browser, which is governed by that site's policy.
- No analytics, tracking cookies, advertising identifiers or remote logging are used.

Contact: https://github.com/Yeosup/BrightTerm/issues
