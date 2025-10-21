(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-RECIPIENT u101)
(define-constant ERR-INVALID-METADATA u102)
(define-constant ERR-INVALID-HASH u103)
(define-constant ERR-SUBMISSION-REJECTED u104)
(define-constant ERR-APPROVAL-REQUIRED u105)
(define-constant ERR-NFT-MINT-FAILED u106)
(define-constant ERR-ALREADY-MINTED u107)
(define-constant ERR-INVALID-TIMESTAMP u108)

(define-data-var next-nft-id uint u0)
(define-data-var archiver-role principal tx-sender)
(define-data-var submission-contract (optional principal) none)
(define-data-var approval-contract (optional principal) none)
(define-data-var timestamp-contract (optional principal) none)

(define-non-fungible-token government-decision uint)

(define-map decision-registry
  uint
  {
    owner: principal,
    metadata-uri: (string-ascii 256),
    content-hash: (buff 32),
    timestamp: uint,
    submission-id: uint,
    approved: bool
  }
)

(define-map minted-submissions uint bool)

(define-read-only (get-decision (id uint))
  (map-get? decision-registry id)
)

(define-read-only (get-nft-owner (id uint))
  (nft-get-owner? government-decision id)
)

(define-read-only (is-submission-minted (submission-id uint))
  (default-to false (map-get? minted-submissions submission-id))
)

(define-read-only (validate-metadata-uri (uri (string-ascii 256)))
  (and (> (len uri) u0) (<= (len uri) u256))
)

(define-read-only (validate-content-hash (hash (buff 32)))
  (is-eq (len hash) u32)
)

(define-public (set-archiver-role (new-archiver principal))
  (begin
    (asserts! (is-eq tx-sender (var-get archiver-role)) (err ERR-UNAUTHORIZED))
    (var-set archiver-role new-archiver)
    (ok true)
  )
)

(define-public (set-submission-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get archiver-role)) (err ERR-UNAUTHORIZED))
    (var-set submission-contract (some contract))
    (ok true)
  )
)

(define-public (set-approval-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get archiver-role)) (err ERR-UNAUTHORIZED))
    (var-set approval-contract (some contract))
    (ok true)
  )
)

(define-public (set-timestamp-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender (var-get archiver-role)) (err ERR-UNAUTHORIZED))
    (var-set timestamp-contract (some contract))
    (ok true)
  )
)

(define-public (mint-decision
    (recipient principal)
    (submission-id uint)
    (metadata-uri (string-ascii 256))
    (content-hash (buff 32))
  )
  (let (
    (nft-id (var-get next-nft-id))
    (submission-ctr (unwrap! (var-get submission-contract) (err ERR-UNAUTHORIZED)))
    (approval-ctr (var-get approval-contract))
    (timestamp-ctr (unwrap! (var-get timestamp-contract) (err ERR-UNAUTHORIZED)))
    (is-minted (is-submission-minted submission-id))
  )
    (asserts! (not is-minted) (err ERR-ALREADY-MINTED))
    (asserts! (not (is-eq recipient tx-sender)) (err ERR-INVALID-RECIPIENT))
    (asserts! (validate-metadata-uri metadata-uri) (err ERR-INVALID-METADATA))
    (asserts! (validate-content-hash content-hash) (err ERR-INVALID-HASH))
    
    (try! (contract-call? submission-ctr validate-submission submission-id content-hash))
    
    (match approval-ctr
      ctr (try! (contract-call? ctr is-approved submission-id))
      (ok true)
    )
    
    (let ((ts-result (contract-call? timestamp-ctr get-current-timestamp)))
      (match ts-result
        timestamp
        (let ((mint-result (nft-mint? government-decision nft-id recipient)))
          (match mint-result
            success
            (begin
              (map-set decision-registry nft-id
                {
                  owner: recipient,
                  metadata-uri: metadata-uri,
                  content-hash: content-hash,
                  timestamp: timestamp,
                  submission-id: submission-id,
                  approved: true
                }
              )
              (map-set minted-submissions submission-id true)
              (var-set next-nft-id (+ nft-id u1))
              (print { event: "decision-minted", id: nft-id, submission: submission-id })
              (ok nft-id)
            )
            (err ERR-NFT-MINT-FAILED)
          )
        )
        (err ERR-INVALID-TIMESTAMP)
      )
    )
  )
)

(define-public (transfer-decision (id uint) (recipient principal))
  (let ((owner (unwrap! (nft-get-owner? government-decision id) (err ERR-UNAUTHORIZED))))
    (asserts! (is-eq tx-sender owner) (err ERR-UNAUTHORIZED))
    (nft-transfer? government-decision id tx-sender recipient)
  )
)

(define-read-only (get-next-nft-id)
  (ok (var-get next-nft-id))
)