# 따라와잉

출발 장소와 도착 장소를 고르면 아래 여정을 한 번에 이어주는 따릉이 통합 길찾기 프로토타입입니다.

`출발지 → 도보 → 대여소에서 대여 → 자전거 → 대여소에 반납 → 도보 → 목적지`

## 현재 프로토타입에서 되는 것

- 서울 주요 장소 자동완성 및 키보드 탐색
- 출발·도착 장소 바꾸기와 현재 위치 사용
- 가장 가까운 대여 대여소 자동 선택
- 목적지 거리와 반납 여유를 고려한 반납 대여소 추천
- 도보·자전거·도보 3개 구간의 지도 경로, 시간, 거리 표시
- 대체 반납 대여소 선택 시 경로 재계산
- 데스크톱 분할 화면과 모바일 지도 우선 레이아웃

대여 가능 자전거와 반납 여유 수량, 경로 좌표와 예상 시간은 현재 데모 데이터입니다. 지도 바탕은 API 키 없이도 프로토타입을 확인할 수 있도록 OpenStreetMap을 사용합니다.

## 실행

Node.js 22.13 이상에서 실행합니다.

```bash
npm install
npm run dev
```

배포용 빌드와 렌더링 검증:

```bash
npm test
```

## 실제 데이터로 확장할 때

네이버 Dynamic Map은 지도 표시와 주소 좌표 변환에 사용할 수 있지만, 공개 Directions API는 자동차 경로만 제공합니다. 따라서 이 서비스의 도보·자전거 혼합 경로는 별도 자전거 라우팅 제공자가 필요합니다. 네이버 지도 앱 URL Scheme은 각 도보·자전거 구간을 앱에서 이어보는 보조 기능으로 사용할 수 있습니다.

장소 자동완성은 NAVER 지역 검색 API 결과를 서버 프록시에서 받아 현재 드롭다운에 연결합니다. Client Secret은 브라우저 코드에 넣지 않습니다.

따릉이 대여소와 실시간 대여 수량은 서울 열린데이터광장의 `bikeList` API를 서버에서 호출해 30~60초 캐시하는 구성이 적합합니다. 공식 응답에는 신뢰 가능한 빈 반납 슬롯 수가 따로 없으므로, 실제 반납 대여소 추천은 거리와 운영 상태를 우선하고 빈자리 표시는 보조 추정값으로 다뤄야 합니다.

참고 문서:

- [NAVER Maps Dynamic Map](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [NAVER Maps Directions 5](https://api.ncloud-docs.com/docs/application-maps-directions5)
- [NAVER 지도 URL Scheme](https://guide.ncloud-docs.com/docs/maps-url-scheme)
- [서울시 공공자전거 실시간 대여정보](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do)
- [서울시 공공자전거 대여소 정보](https://data.seoul.go.kr/dataList/OA-13252/F/1/datasetView.do)
